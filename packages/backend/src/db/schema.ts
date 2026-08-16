/**
 * SQLite schema for the domain model (project plan §4).
 *
 * The database file *is* the shareable unit, so the schema is the durable
 * contract. Column names are snake_case (SQL idiom); the persistence layer maps
 * them to/from the camelCase domain types in `@ecp/shared`.
 *
 * Dates are stored as ISO-8601 `YYYY-MM-DD` TEXT. Booleans are stored as
 * INTEGER `0`/`1`. Foreign keys are declared and enforced (PRAGMA set on open).
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS team (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  sprint_length_days   INTEGER NOT NULL,
  sprint_start_weekday INTEGER NOT NULL,
  sprint_anchor_date   TEXT NOT NULL,
  -- JSON array of weekday indices (0=Sun..6=Sat), e.g. "[1,2,3,4,5]".
  working_days         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_member (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  base_velocity REAL NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  -- Jira accountId this member is linked to (NULL for a purely local member).
  -- Lets a synced assignee map back onto a hand-created person (project plan §7).
  jira_account_id TEXT,
  -- URL of the member's Jira avatar image (NULL when unlinked/unknown).
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS velocity_override (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  multiplier REAL NOT NULL,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS pto (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS oncall (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  note       TEXT
);

-- One self-reported workload signal per member and local calendar day. This is
-- intentionally local planning history, not imported from Jira.
CREATE TABLE IF NOT EXISTS bandwidth_check_in (
  member_id     TEXT NOT NULL REFERENCES team_member(id) ON DELETE RESTRICT,
  check_in_date TEXT NOT NULL,
  feeling       TEXT NOT NULL CHECK(feeling IN ('red', 'yellow', 'green', 'purple')),
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (member_id, check_in_date)
);

CREATE TABLE IF NOT EXISTS epic (
  key     TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  source_status TEXT,
  status_category TEXT,
  archived_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_epic (
  epic_key TEXT PRIMARY KEY REFERENCES epic(key) ON DELETE CASCADE,
  scope_override TEXT NOT NULL DEFAULT 'auto' CHECK(scope_override IN ('auto', 'include', 'exclude')),
  planning_kind TEXT NOT NULL DEFAULT 'timeline' CHECK(planning_kind IN ('timeline', 'ongoing')),
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS epic_sme (
  epic_key  TEXT NOT NULL REFERENCES epic(key) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL CHECK(rank >= 0),
  PRIMARY KEY (epic_key, member_id),
  UNIQUE (epic_key, rank)
);

CREATE TABLE IF NOT EXISTS epic_milestone (
  id        TEXT PRIMARY KEY,
  epic_key  TEXT NOT NULL REFERENCES epic(key) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  date      TEXT NOT NULL,
  is_gating INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_story (
  key      TEXT PRIMARY KEY,
  epic_key TEXT NOT NULL REFERENCES epic(key) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  -- JSON array of parent labels, e.g. '["Cart"]'. Gantt lanes may inherit
  -- these onto child work items when enabled for an epic.
  labels   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS work_item (
  key         TEXT PRIMARY KEY,
  story_key   TEXT NOT NULL REFERENCES user_story(key) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  points      REAL NOT NULL,
  is_estimated INTEGER NOT NULL DEFAULT 1,
  jira_sprint_assigned INTEGER,
  status      TEXT NOT NULL,
  assignee_id TEXT REFERENCES team_member(id) ON DELETE SET NULL,
  -- JSON array of freeform labels, e.g. '["Cart","Payments"]'. Drives the
  -- Gantt Planner's horizontal lanes. Defaults to an empty array.
  labels      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS dependency (
  id                TEXT PRIMARY KEY,
  blocker_item_key  TEXT NOT NULL REFERENCES work_item(key) ON DELETE CASCADE,
  blocked_item_key  TEXT NOT NULL REFERENCES work_item(key) ON DELETE CASCADE,
  UNIQUE (blocker_item_key, blocked_item_key)
);

-- Stored sprints (project plan §6a). Authoritative bounds for the Gantt weeks;
-- synthetic data derives them from cadence, Jira supplies them in Phase 7.
CREATE TABLE IF NOT EXISTS sprint (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL
);

-- Human-authored week placements for the Gantt Planner (project plan §6a).
-- At most one placement per work item (unplaced items live in the backlog bag).
CREATE TABLE IF NOT EXISTS planned_placement (
  id            TEXT PRIMARY KEY,
  work_item_key TEXT NOT NULL UNIQUE REFERENCES work_item(key) ON DELETE CASCADE,
  sprint_id     TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE,
  week_index    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key      TEXT NOT NULL,
  scope    TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT,
  value    TEXT NOT NULL,
  -- One row per (key, scope, scope_id). scope_id is '' for global rows so the
  -- primary key stays well-defined (SQLite treats NULLs as distinct otherwise).
  PRIMARY KEY (key, scope, scope_id)
);

-- Sync log (project plan §7): one row per successful sync, recording what
-- reconcile changed. Deliberately *outside* INSERT_ORDER/DELETE_ORDER so the
-- dataset-replacing writeDataset() never clears it — the history accretes.
CREATE TABLE IF NOT EXISTS sync_log (
  id        TEXT PRIMARY KEY,
  synced_at TEXT NOT NULL,
  source    TEXT NOT NULL,
  -- JSON: the ReconcileSummary counts.
  summary   TEXT NOT NULL,
  -- JSON: an array of SyncChange entries (the itemized card modal).
  changes   TEXT NOT NULL
);

-- Standup history is intentionally separate from DomainDataset replacement.
CREATE TABLE IF NOT EXISTS standup_session (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team(id) ON DELETE RESTRICT,
  standup_date TEXT NOT NULL,
  sprint_id TEXT,
  sprint_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'post_standup', 'completed')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  final_schema_version INTEGER,
  final_snapshot_json TEXT,
  UNIQUE(team_id, standup_date)
);

CREATE TABLE IF NOT EXISTS standup_participant (
  session_id TEXT NOT NULL REFERENCES standup_session(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_member(id) ON DELETE RESTRICT,
  member_name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  disposition TEXT NOT NULL DEFAULT 'pending' CHECK(disposition IN ('pending', 'completed', 'skipped')),
  resolved_at TEXT,
  PRIMARY KEY(session_id, member_id),
  UNIQUE(session_id, position)
);

CREATE TABLE IF NOT EXISTS standup_note (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES standup_session(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  all_team INTEGER NOT NULL DEFAULT 0 CHECK(all_team IN (0, 1)),
  position INTEGER NOT NULL CHECK(position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, position)
);

CREATE TABLE IF NOT EXISTS standup_note_member (
  note_id TEXT NOT NULL REFERENCES standup_note(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_member(id) ON DELETE RESTRICT,
  PRIMARY KEY(note_id, member_id)
);

CREATE TABLE IF NOT EXISTS standup_context_snapshot (
  session_id TEXT NOT NULL REFERENCES standup_session(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global', 'member')),
  scope_key TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('jira', 'local', 'snapshot')),
  fetch_status TEXT NOT NULL CHECK(fetch_status IN ('fresh', 'stale', 'unavailable')),
  error_message TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(session_id, scope_kind, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_member_team       ON team_member(team_id);
CREATE INDEX IF NOT EXISTS idx_bandwidth_check_in_date ON bandwidth_check_in(check_in_date);
CREATE INDEX IF NOT EXISTS idx_story_epic         ON user_story(epic_key);
CREATE INDEX IF NOT EXISTS idx_work_item_story    ON work_item(story_key);
CREATE INDEX IF NOT EXISTS idx_work_item_assignee ON work_item(assignee_id);
CREATE INDEX IF NOT EXISTS idx_milestone_epic     ON epic_milestone(epic_key);
CREATE INDEX IF NOT EXISTS idx_epic_sme_member    ON epic_sme(member_id);
CREATE INDEX IF NOT EXISTS idx_dep_blocker        ON dependency(blocker_item_key);
CREATE INDEX IF NOT EXISTS idx_dep_blocked        ON dependency(blocked_item_key);
CREATE INDEX IF NOT EXISTS idx_sprint_team        ON sprint(team_id);
CREATE INDEX IF NOT EXISTS idx_placement_sprint   ON planned_placement(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_time       ON sync_log(synced_at);
CREATE INDEX IF NOT EXISTS idx_standup_session_team_date ON standup_session(team_id, standup_date);
CREATE INDEX IF NOT EXISTS idx_standup_participant_session ON standup_participant(session_id, position);
`;

/** Order tables must be inserted into to satisfy foreign keys. */
export const INSERT_ORDER = [
  'team',
  'team_member',
  'bandwidth_check_in',
  'velocity_override',
  'pto',
  'oncall',
  'sprint',
  'epic',
  'portfolio_epic',
  'epic_sme',
  'epic_milestone',
  'user_story',
  'work_item',
  'dependency',
  'planned_placement',
  'settings',
] as const;

/** Order tables must be cleared in to satisfy foreign keys (reverse of insert). */
export const DELETE_ORDER = [...INSERT_ORDER].reverse();
