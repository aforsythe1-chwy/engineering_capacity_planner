import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

export interface OpenDbOptions {
  /**
   * File path for the database, or `':memory:'` for an ephemeral in-memory DB
   * (used by tests). Defaults to `':memory:'`.
   */
  path?: string;
}

/**
 * Open a SQLite database, enable foreign-key enforcement, and ensure the schema
 * exists. Safe to call against an existing database file (the schema uses
 * `IF NOT EXISTS`).
 */
export function openDatabase(options: OpenDbOptions = {}): Db {
  const path = options.path ?? ':memory:';
  // Ensure the parent directory exists so a first run (fresh clone, no `data/`)
  // can create the file instead of crashing.
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/**
 * Idempotent, additive migrations for database files created by an older
 * schema. `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a new
 * column must be added explicitly here.
 */
function migrate(db: Db): void {
  for (const table of ['pto', 'oncall', 'velocity_override']) {
    ensureColumn(db, table, 'note', 'TEXT');
  }
  // Gantt Planner (project plan §6a): labels on work items. The `sprint` and
  // `planned_placement` tables are created by `CREATE TABLE IF NOT EXISTS`.
  ensureColumn(db, 'work_item', 'labels', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'user_story', 'labels', "TEXT NOT NULL DEFAULT '[]'");
  // Jira setup wizard (project plan §7): link a member to a Jira account, and
  // remember their Jira avatar image.
  ensureColumn(db, 'team_member', 'jira_account_id', 'TEXT');
  ensureColumn(db, 'team_member', 'avatar_url', 'TEXT');
  ensureColumn(db, 'epic', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'epic', 'source_status', 'TEXT');
  ensureColumn(db, 'epic', 'status_category', 'TEXT');
  ensureColumn(db, 'epic', 'archived_at', 'TEXT');
  ensureColumn(db, 'epic', 'last_seen_at', 'TEXT');
  ensureColumn(db, 'work_item', 'is_estimated', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'work_item', 'jira_sprint_assigned', 'INTEGER');
  // Older SQLite tables cannot gain this CHECK constraint additively. The
  // repository validates values as well; fresh databases retain the check.
  ensureColumn(db, 'portfolio_epic', 'planning_kind', "TEXT NOT NULL DEFAULT 'timeline'");
  // This index references a column introduced above, so it must be created
  // after additive migrations when opening databases from older releases.
  db.exec('CREATE INDEX IF NOT EXISTS idx_epic_active ON epic(active)');
}

/** Add `column` to `table` if it's not already present. */
function ensureColumn(db: Db, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
