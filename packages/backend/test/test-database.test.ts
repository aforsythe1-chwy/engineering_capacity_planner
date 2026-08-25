import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { prepareRuntimeDatabase, TestDatabaseError } from '../src/db/test-database.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ecp-test-db-helper-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function createSource(): string {
  const path = join(dir, 'source.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE values_table (value TEXT NOT NULL)');
  db.prepare('INSERT INTO values_table (value) VALUES (?)').run('persistent baseline');
  // Deliberately leave committed WAL content for the online-backup assertion.
  db.close();
  return path;
}

function values(path: string): string[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const result = db.prepare('SELECT value FROM values_table ORDER BY rowid').all() as { value: string }[];
  db.close();
  return result.map((row) => row.value);
}

describe('prepareRuntimeDatabase', () => {
  it('creates an isolated consistent copy and removes only its workspace', async () => {
    const sourcePath = createSource();
    const target = await prepareRuntimeDatabase(sourcePath, true);

    expect(target.mode).toBe('test-copy');
    expect(target.sourcePath).toBe(sourcePath);
    expect(target.effectivePath).not.toBe(sourcePath);
    expect(values(target.effectivePath)).toEqual(['persistent baseline']);

    const copy = new Database(target.effectivePath);
    copy.prepare('INSERT INTO values_table (value) VALUES (?)').run('disposable edit');
    copy.close();
    expect(values(sourcePath)).toEqual(['persistent baseline']);

    target.cleanup();
    target.cleanup();
    expect(existsSync(target.effectivePath)).toBe(false);
    expect(values(sourcePath)).toEqual(['persistent baseline']);
  });

  it('creates independent fresh copies for concurrent runs', async () => {
    const sourcePath = createSource();
    const [first, second] = await Promise.all([
      prepareRuntimeDatabase(sourcePath, true),
      prepareRuntimeDatabase(sourcePath, true),
    ]);

    expect(first.effectivePath).not.toBe(second.effectivePath);
    const firstDb = new Database(first.effectivePath);
    firstDb.prepare('INSERT INTO values_table (value) VALUES (?)').run('first only');
    firstDb.close();
    expect(values(second.effectivePath)).toEqual(['persistent baseline']);

    first.cleanup();
    second.cleanup();
  });

  it('keeps normal mode unchanged', async () => {
    const path = join(dir, 'normal-mode.db');
    const target = await prepareRuntimeDatabase(path, false);
    expect(target).toMatchObject({ sourcePath: path, effectivePath: path, mode: 'persistent' });
    target.cleanup();
  });

  it('rejects unsupported and invalid test-mode sources before application startup', async () => {
    await expect(prepareRuntimeDatabase(':memory:', true)).rejects.toThrow(TestDatabaseError);
    await expect(prepareRuntimeDatabase('file:source.db?mode=ro', true)).rejects.toThrow(TestDatabaseError);
    await expect(prepareRuntimeDatabase(join(dir, 'missing.db'), true)).rejects.toThrow(/existing readable regular file/);
    await expect(prepareRuntimeDatabase(dir, true)).rejects.toThrow(/existing readable regular file/);
  });
});
