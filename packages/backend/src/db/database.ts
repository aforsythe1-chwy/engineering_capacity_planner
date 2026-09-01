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
  ensureColumn(db, 'sprint', 'state', 'TEXT');
  ensureColumn(db, 'sprint', 'goal', 'TEXT');
  ensureColumn(db, 'sprint', 'origin_board_id', 'TEXT');
  ensureColumn(db, 'bandwidth_check_in', 'session_id', 'TEXT');
  ensureColumn(db, 'standup_note', 'note_state', "TEXT NOT NULL DEFAULT 'open'");
  ensureColumn(db, 'standup_note', 'completed_at', 'TEXT');
  ensureColumn(db, 'standup_note', 'deferred_at', 'TEXT');
  // SQLite cannot reliably add a self-referencing FK to older tables. Repository
  // validation and the fresh-schema FK protect the relationship.
  ensureColumn(db, 'standup_note', 'source_note_id', 'TEXT');
  // The active participant is durable note context. Older notes intentionally
  // remain null because their original participant cannot be inferred safely.
  ensureColumn(db, 'standup_note', 'context_member_id', 'TEXT');
  ensureColumn(db, 'standup_note', 'context_member_name', 'TEXT');
  ensureColumn(db, 'global_important_date', 'notes', 'TEXT');
  ensureColumn(db, 'global_important_date', 'link_url', 'TEXT');
  // Older SQLite tables cannot gain this CHECK constraint additively. The
  // repository validates values as well; fresh databases retain the check.
  ensureColumn(db, 'portfolio_epic', 'planning_kind', "TEXT NOT NULL DEFAULT 'timeline'");
  // This index references a column introduced above, so it must be created
  // after additive migrations when opening databases from older releases.
  db.exec('CREATE INDEX IF NOT EXISTS idx_epic_active ON epic(active)');
  db.exec('CREATE TABLE IF NOT EXISTS team_holiday (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE, date TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(team_id, date, name)); CREATE INDEX IF NOT EXISTS idx_team_holiday_date ON team_holiday(team_id, date, name)');
  db.exec(`CREATE TABLE IF NOT EXISTS standup_note_mention (
    note_id TEXT NOT NULL REFERENCES standup_note(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    mention_kind TEXT NOT NULL CHECK(mention_kind IN ('member', 'group')),
    mention_id TEXT NOT NULL, label TEXT NOT NULL,
    PRIMARY KEY(note_id, position), UNIQUE(note_id, mention_kind, mention_id)
  ); CREATE UNIQUE INDEX IF NOT EXISTS idx_standup_note_source ON standup_note(source_note_id) WHERE source_note_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS intake_request_awareness (
    id TEXT PRIMARY KEY, jira_key TEXT NOT NULL UNIQUE,
    standup_session_id TEXT NOT NULL REFERENCES standup_session(id) ON DELETE RESTRICT,
    aware_date TEXT NOT NULL, date_confidence TEXT NOT NULL CHECK(date_confidence IN ('high', 'medium', 'low')),
    notes TEXT, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_intake_awareness_date ON intake_request_awareness(aware_date, jira_key)`);
}

/** Add `column` to `table` if it's not already present. */
function ensureColumn(db: Db, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
