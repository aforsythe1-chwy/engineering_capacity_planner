import { accessSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { constants } from 'node:fs';
import Database from 'better-sqlite3';

export type DatabaseMode = 'persistent' | 'test-copy';

/** The database path a server instance owns for its complete lifetime. */
export interface RuntimeDatabaseTarget {
  sourcePath: string;
  effectivePath: string;
  mode: DatabaseMode;
  /** Remove this run's uniquely-created workspace. Safe to call repeatedly. */
  cleanup(): void;
}

export class TestDatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TestDatabaseError';
  }
}

/**
 * Produce the database target for a server process.
 *
 * Test mode opens the configured source read-only and uses SQLite's online
 * backup API, so committed WAL content is captured without ever migrating or
 * otherwise writing to the configured source database.
 */
export async function prepareRuntimeDatabase(
  configuredPath: string,
  testDb: boolean,
): Promise<RuntimeDatabaseTarget> {
  if (!testDb) {
    return {
      sourcePath: configuredPath,
      effectivePath: configuredPath,
      mode: 'persistent',
      cleanup: () => {},
    };
  }

  const sourcePath = validateSourcePath(configuredPath);
  let workspace: string | undefined;
  let source: Database.Database | undefined;
  let prepared = false;

  try {
    workspace = mkdtempSync(join(tmpdir(), 'ecp-test-db-'));
    const effectivePath = join(workspace, basename(sourcePath));
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    await source.backup(effectivePath);
    prepared = true;

    let cleaned = false;
    return {
      sourcePath,
      effectivePath,
      mode: 'test-copy',
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        rmSync(workspace!, { recursive: true, force: true });
      },
    };
  } catch (error) {
    throw new TestDatabaseError(`Unable to prepare ECP_TEST_DB copy from ${sourcePath}`, { cause: error });
  } finally {
    try {
      source?.close();
    } finally {
      // A successful target owns its workspace until its cleanup callback runs.
      // Every failure removes only the exact directory created by mkdtemp.
      if (workspace && !prepared) rmSync(workspace, { recursive: true, force: true });
    }
  }
}

function validateSourcePath(configuredPath: string): string {
  if (configuredPath === ':memory:' || /^file:/i.test(configuredPath)) {
    throw new TestDatabaseError(
      'ECP_TEST_DB requires ECP_DB_PATH to be an existing filesystem database file; :memory: and SQLite URI paths are unsupported.',
    );
  }

  const sourcePath = resolve(configuredPath);
  try {
    if (!statSync(sourcePath).isFile()) {
      throw new Error('not a regular file');
    }
    accessSync(sourcePath, constants.R_OK);
  } catch (error) {
    throw new TestDatabaseError(
      `ECP_TEST_DB requires ECP_DB_PATH to be an existing readable regular file: ${sourcePath}`,
      { cause: error },
    );
  }
  return sourcePath;
}
