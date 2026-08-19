/**
 * Granular write operations for the configurable slice of the domain (project
 * plan §6 "Configuration tab"): team cadence, members, PTO, on-call, velocity
 * overrides, epic relevant-days (milestones), and the settings knobs.
 *
 * The importer's {@link import('./persist.js').writeDataset} replaces the whole
 * database at once; this module edits individual rows so the Configuration UI
 * can persist one change at a time. Every function validates its input and
 * throws {@link HttpError} (400/404/409) on bad requests, and multi-row changes
 * run in a transaction. Column ↔ domain mapping mirrors `persist.ts`.
 */
import { randomUUID } from 'node:crypto';
import type {
  EpicMilestone,
  GlobalImportantDate,
  ImportantDateIconKey,
  EpicEstimate,
  EpicPlanningKind,
  PortfolioEpic,
  PortfolioScopeOverride,
  IsoDate,
  Oncall,
  PlannedPlacement,
  Pto,
  Setting,
  Team,
  TeamMember,
  VelocityOverride,
  Weekday,
} from '@ecp/shared';
import { diffDays, IMPORTANT_DATE_ICON_KEYS, SETTING_KEYS } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';
import { memberHasBandwidthHistory } from './bandwidth.js';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: unknown, field: string): IsoDate {
  const parsed = typeof value === 'string' && ISO_DATE.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}

function assertNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; int?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a finite number`);
  }
  if (opts.int && !Number.isInteger(value)) throw badRequest(`${field} must be an integer`);
  if (opts.min !== undefined && value < opts.min) {
    throw badRequest(`${field} must be ≥ ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw badRequest(`${field} must be ≤ ${opts.max}`);
  }
  return value;
}

function assertWeekday(value: unknown, field: string): Weekday {
  const n = assertNumber(value, field, { int: true });
  if (n < 0 || n > 6) throw badRequest(`${field} must be a weekday index 0–6`);
  return n as Weekday;
}

function assertDateOrder(start: IsoDate, end: IsoDate): void {
  if (end < start) throw badRequest('endDate must be on or after startDate');
}

/** Optional free-text note: trimmed to a string, or null when blank/absent. */
function noteOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be a string');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Row → domain mappers (single row)
// ---------------------------------------------------------------------------

const memberRow = (r: any): TeamMember => ({
  id: r.id,
  teamId: r.team_id,
  name: r.name,
  baseVelocity: r.base_velocity,
  active: r.active === 1,
  jiraAccountId: r.jira_account_id ?? null,
  avatarUrl: r.avatar_url ?? null,
});

const teamRow = (r: any): Team => ({
  id: r.id,
  name: r.name,
  sprintLengthDays: r.sprint_length_days,
  sprintStartWeekday: r.sprint_start_weekday,
  sprintAnchorDate: r.sprint_anchor_date,
  workingDays: JSON.parse(r.working_days),
});

const ptoRow = (r: any): Pto => ({
  id: r.id,
  memberId: r.member_id,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note ?? null,
});

const oncallRow = (r: any): Oncall => ({
  id: r.id,
  memberId: r.member_id,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note ?? null,
});

const velocityRow = (r: any): VelocityOverride => ({
  id: r.id,
  memberId: r.member_id,
  startDate: r.start_date,
  endDate: r.end_date,
  multiplier: r.multiplier,
  note: r.note ?? null,
});

const milestoneRow = (r: any): EpicMilestone => ({
  id: r.id,
  epicKey: r.epic_key,
  name: r.name,
  date: r.date,
  isGating: r.is_gating === 1,
});
const importantDateRow = (r: any): GlobalImportantDate => ({ id: r.id, name: r.name, date: r.date, iconKey: r.icon_key, notes: r.notes ?? null, linkUrl: r.link_url ?? null });

function assertImportantDateIcon(value: unknown): ImportantDateIconKey {
  if (typeof value !== 'string' || !(IMPORTANT_DATE_ICON_KEYS as readonly string[]).includes(value)) {
    throw badRequest('iconKey must be an allowed important-date icon');
  }
  return value as ImportantDateIconKey;
}

function importantDateNotes(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('notes must be a string');
  const result = value.trim();
  if (result.length > 2000) throw badRequest('notes must be at most 2000 characters');
  return result || null;
}

function importantDateLink(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('linkUrl must be a string');
  const result = value.trim();
  if (!result) return null;
  try {
    const url = new URL(result);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch { throw badRequest('linkUrl must be an http(s) URL'); }
}

// ---------------------------------------------------------------------------
// Existence helpers
// ---------------------------------------------------------------------------

function requireTeam(db: Db, id: string): void {
  const row = db.prepare('SELECT 1 FROM team WHERE id = ?').get(id);
  if (!row) throw notFound(`Team ${id} not found`);
}

function requireMember(db: Db, id: string): void {
  const row = db.prepare('SELECT 1 FROM team_member WHERE id = ?').get(id);
  if (!row) throw notFound(`Member ${id} not found`);
}

function requireEpic(db: Db, key: string): void {
  const row = db.prepare('SELECT 1 FROM epic WHERE key = ?').get(key);
  if (!row) throw notFound(`Epic ${key} not found`);
}

/** Merge and validate a local portfolio-intent patch without resetting fields
 * the caller did not mean to touch. */
export function updatePortfolioEpic(db: Db, epicKey: string, patch: {
  scopeOverride?: unknown;
  planningKind?: unknown;
  priority?: unknown;
}): PortfolioEpic {
  requireEpic(db, epicKey);
  const entries = Object.keys(patch);
  if (entries.length === 0) throw badRequest('At least one portfolio intent field is required');
  if (entries.some((key) => !['scopeOverride', 'planningKind', 'priority'].includes(key))) {
    throw badRequest('Unknown portfolio intent field');
  }
  const current = db.prepare('SELECT scope_override, planning_kind, priority FROM portfolio_epic WHERE epic_key = ?').get(epicKey) as any;
  const scopeOverride = patch.scopeOverride === undefined ? (current?.scope_override ?? 'auto') : patch.scopeOverride;
  const planningKind = patch.planningKind === undefined ? (current?.planning_kind ?? 'timeline') : patch.planningKind;
  const priority = patch.priority === undefined ? (current?.priority ?? 0) : patch.priority;
  if (!['auto', 'include', 'exclude'].includes(scopeOverride as string)) throw badRequest('scopeOverride must be auto, include, or exclude');
  if (!['timeline', 'ongoing'].includes(planningKind as string)) throw badRequest('planningKind must be timeline or ongoing');
  assertNumber(priority, 'priority', { int: true });
  const result: PortfolioEpic = { epicKey, scopeOverride: scopeOverride as PortfolioScopeOverride, planningKind: planningKind as EpicPlanningKind, priority: priority as number };
  db.prepare(`INSERT INTO portfolio_epic (epic_key, scope_override, planning_kind, priority) VALUES (@epicKey, @scopeOverride, @planningKind, @priority)
    ON CONFLICT(epic_key) DO UPDATE SET scope_override = excluded.scope_override, planning_kind = excluded.planning_kind, priority = excluded.priority`).run(result);
  return result;
}

// ---------------------------------------------------------------------------
// Progressive epic estimates (local intent, acknowledged against Jira facts)
// ---------------------------------------------------------------------------

function canonicalFactBasis(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('reviewed fact basis must be an object');
  const entries = Object.entries(value).map(([key, points]) => {
    if (typeof key !== 'string' || key.trim() === '') throw badRequest('reviewed fact basis keys must be non-empty');
    if (points !== null && (typeof points !== 'number' || !Number.isFinite(points))) throw badRequest('reviewed fact basis values must be finite numbers or null');
    return [key, points] as const;
  }).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

export function saveEpicEstimate(
  db: Db,
  epicKey: string,
  input: { unrefinedPoints?: unknown; reviewedFactBasis?: unknown; now?: string },
): EpicEstimate {
  requireEpic(db, epicKey);
  if (Object.keys(input).some((key) => !['unrefinedPoints', 'reviewedFactBasis', 'now'].includes(key))) throw badRequest('Unknown epic estimate field');
  const unrefinedPoints = assertNumber(input.unrefinedPoints, 'unrefinedPoints', { min: 0 });
  const reviewedFactBasis = canonicalFactBasis(input.reviewedFactBasis);
  const now = input.now ?? new Date().toISOString();
  const estimate: EpicEstimate = { epicKey, unrefinedPoints, reviewedFactBasis, reviewedAt: now, updatedAt: now };
  db.prepare(
    `INSERT INTO epic_estimate (epic_key, unrefined_points, reviewed_fact_basis_json, reviewed_at, updated_at)
     VALUES (@epicKey, @unrefinedPoints, @reviewedFactBasis, @reviewedAt, @updatedAt)
     ON CONFLICT(epic_key) DO UPDATE SET unrefined_points = excluded.unrefined_points,
       reviewed_fact_basis_json = excluded.reviewed_fact_basis_json, reviewed_at = excluded.reviewed_at,
       updated_at = excluded.updated_at`,
  ).run({ ...estimate, reviewedFactBasis: JSON.stringify(reviewedFactBasis) });
  return estimate;
}

export function deleteEpicEstimate(db: Db, epicKey: string): void {
  requireEpic(db, epicKey);
  db.prepare('DELETE FROM epic_estimate WHERE epic_key = ?').run(epicKey);
}

// ---------------------------------------------------------------------------
// Settings knobs
// ---------------------------------------------------------------------------

/** Global settings the Configuration UI may edit, with their value validators. */
const EDITABLE_SETTINGS: Record<string, (value: unknown, key: string) => unknown> = {
  [SETTING_KEYS.ONCALL_MULTIPLIER]: (v, k) => assertNumber(v, k, { min: 0 }),
  [SETTING_KEYS.GREEN_MIN_BUFFER_DAYS]: (v, k) => assertNumber(v, k, { min: 0, int: true }),
  [SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION]: (v, k) => assertNumber(v, k, { min: 0, max: 1 }),
  [SETTING_KEYS.PLANNING_TODAY]: (v, k) => (v === null ? null : assertIsoDate(v, k)),
  [SETTING_KEYS.JIRA_FLAVOR]: nullableString,
  [SETTING_KEYS.JIRA_STORY_POINTS_FIELD]: nullableString,
  [SETTING_KEYS.JIRA_PROJECT_KEY]: nullableString,
  [SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE]: nullableString,
  [SETTING_KEYS.JIRA_EPIC_KEY]: nullableString,
  [SETTING_KEYS.JIRA_EPIC_SCOPE_MODE]: (v, k) => {
    if (v !== 'single' && v !== 'active') throw badRequest(`${k} must be "single" or "active"`);
    return v;
  },
  [SETTING_KEYS.JIRA_BOARD_ID]: nullableString,
  [SETTING_KEYS.JIRA_BOARD_NAME]: nullableString,
  [SETTING_KEYS.JIRA_SPRINT_FIELD]: nullableString,
  [SETTING_KEYS.JIRA_LABELS_FIELD]: nullableString,
  [SETTING_KEYS.STANDUP_STATUS_PRESENTATION]: standupStatusPresentationSetting,
};

/** Epic-scoped settings the Configuration UI may edit. */
const EDITABLE_EPIC_SETTINGS: Record<string, (value: unknown, key: string) => unknown> = {
  [SETTING_KEYS.GANTT_APPLY_PARENT_LABELS]: booleanSetting,
  [SETTING_KEYS.GANTT_IGNORE_LABELS]: stringListSetting,
};

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`);
  return value;
}

function standupStatusPresentationSetting(value: unknown, field: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} must be an object`);
  const doc = value as Record<string, unknown>;
  if (Object.keys(doc).some((key) => key !== 'version' && key !== 'boards') || doc.version !== 1 || !Array.isArray(doc.boards)) {
    throw badRequest(`${field} must be a version 1 status presentation document`);
  }
  if (doc.boards.length > 20) throw badRequest(`${field}.boards may contain at most 20 boards`);
  const boardIds = new Set<string>();
  const boards = doc.boards.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest(`${field}.boards[${index}] must be an object`);
    const board = raw as Record<string, unknown>;
    if (Object.keys(board).some((key) => !['boardId', 'boardName', 'entries'].includes(key)) || !Array.isArray(board.entries)) throw badRequest(`${field}.boards[${index}] has unknown or invalid fields`);
    const boardId = boundedText(board.boardId, `${field}.boards[${index}].boardId`);
    const boardName = boundedText(board.boardName, `${field}.boards[${index}].boardName`);
    if (boardIds.has(boardId)) throw badRequest(`${field} contains duplicate board IDs`);
    boardIds.add(boardId);
    if (board.entries.length > 100) throw badRequest(`${field}.boards[${index}].entries may contain at most 100 statuses`);
    const statusIds = new Set<string>();
    const entries = board.entries.map((entryRaw, entryIndex) => {
      if (!entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw)) throw badRequest(`${field}.boards[${index}].entries[${entryIndex}] must be an object`);
      const entry = entryRaw as Record<string, unknown>;
      if (Object.keys(entry).some((key) => !['statusId', 'sourceName', 'sourceCategory', 'sourceColumnName', 'friendlyName'].includes(key))) throw badRequest(`${field}.boards[${index}].entries[${entryIndex}] has unknown fields`);
      const statusId = boundedText(entry.statusId, `${field}.boards[${index}].entries[${entryIndex}].statusId`);
      const sourceName = boundedText(entry.sourceName, `${field}.boards[${index}].entries[${entryIndex}].sourceName`);
      const sourceCategory = boundedText(entry.sourceCategory, `${field}.boards[${index}].entries[${entryIndex}].sourceCategory`);
      const friendlyName = boundedText(entry.friendlyName, `${field}.boards[${index}].entries[${entryIndex}].friendlyName`);
      const sourceColumnName = entry.sourceColumnName === null ? null : boundedText(entry.sourceColumnName, `${field}.boards[${index}].entries[${entryIndex}].sourceColumnName`);
      if (statusIds.has(statusId)) throw badRequest(`${field} contains duplicate status IDs`);
      statusIds.add(statusId);
      return { statusId, sourceName, sourceCategory, sourceColumnName, friendlyName };
    });
    return { boardId, boardName, entries };
  });
  return { version: 1, boards };
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${field} must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > 100) throw badRequest(`${field} must be at most 100 characters`);
  return trimmed;
}

function booleanSetting(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be a boolean`);
  return value;
}

function stringListSetting(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array of strings`);
  const labels = value.map((v) => {
    if (typeof v !== 'string') throw badRequest(`${field} must be an array of strings`);
    return v.trim();
  });
  return [...new Set(labels.filter((v) => v !== ''))];
}

/**
 * Upsert one or more global settings from a `{ key: value }` map, where `value`
 * is the raw (decoded) value. Unknown keys are rejected. Returns the full list
 * of global settings after the change.
 */
export function upsertGlobalSettings(db: Db, patch: Record<string, unknown>): Setting[] {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw badRequest('No settings provided');

  const validated = entries.map(([key, value]) => {
    const validate = EDITABLE_SETTINGS[key];
    if (!validate) throw badRequest(`Unknown or read-only setting "${key}"`);
    return { key, value: JSON.stringify(validate(value, key)) };
  });

  const stmt = db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value) VALUES (@key, 'global', '', @value)
     ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value`,
  );
  const run = db.transaction((rows: { key: string; value: string }[]) => {
    for (const row of rows) stmt.run(row);
  });
  run(validated);

  return db
    .prepare("SELECT * FROM settings WHERE scope = 'global'")
    .all()
    .map(
      (r: any): Setting => ({
        key: r.key,
        scope: r.scope,
        scopeId: r.scope_id === '' ? null : r.scope_id,
        value: r.value,
      }),
    );
}

/**
 * Upsert one or more epic-scoped settings for the given epic. Unknown keys are
 * rejected, and the returned rows are all settings scoped to that epic.
 */
export function upsertEpicSettings(db: Db, epicKey: string, patch: Record<string, unknown>): Setting[] {
  requireEpic(db, epicKey);
  const entries = Object.entries(patch);
  if (entries.length === 0) throw badRequest('No settings provided');

  const validated = entries.map(([key, value]) => {
    const validate = EDITABLE_EPIC_SETTINGS[key];
    if (!validate) throw badRequest(`Unknown or read-only epic setting "${key}"`);
    return { key, scopeId: epicKey, value: JSON.stringify(validate(value, key)) };
  });

  const stmt = db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value) VALUES (@key, 'epic', @scopeId, @value)
     ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value`,
  );
  const run = db.transaction((rows: { key: string; scopeId: string; value: string }[]) => {
    for (const row of rows) stmt.run(row);
  });
  run(validated);

  return db
    .prepare("SELECT * FROM settings WHERE scope = 'epic' AND scope_id = ?")
    .all(epicKey)
    .map(
      (r: any): Setting => ({
        key: r.key,
        scope: r.scope,
        scopeId: r.scope_id === '' ? null : r.scope_id,
        value: r.value,
      }),
    );
}

// ---------------------------------------------------------------------------
// Team cadence
// ---------------------------------------------------------------------------

export interface TeamPatch {
  name?: unknown;
  sprintLengthDays?: unknown;
  sprintStartWeekday?: unknown;
  sprintAnchorDate?: unknown;
  workingDays?: unknown;
}

/** Update a team's cadence fields (any subset). Returns the updated team. */
export function updateTeam(db: Db, id: string, patch: TeamPatch): Team {
  requireTeam(db, id);
  const current = teamRow(db.prepare('SELECT * FROM team WHERE id = ?').get(id));

  const next: Team = { ...current };
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name');
  if (patch.sprintLengthDays !== undefined) {
    next.sprintLengthDays = assertNumber(patch.sprintLengthDays, 'sprintLengthDays', { min: 1, int: true });
  }
  if (patch.sprintStartWeekday !== undefined) {
    next.sprintStartWeekday = assertWeekday(patch.sprintStartWeekday, 'sprintStartWeekday');
  }
  if (patch.sprintAnchorDate !== undefined) {
    next.sprintAnchorDate = assertIsoDate(patch.sprintAnchorDate, 'sprintAnchorDate');
  }
  if (patch.workingDays !== undefined) next.workingDays = assertWorkingDays(patch.workingDays);

  db.prepare(
    `UPDATE team SET name = @name, sprint_length_days = @sprintLengthDays,
       sprint_start_weekday = @sprintStartWeekday, sprint_anchor_date = @sprintAnchorDate,
       working_days = @workingDays WHERE id = @id`,
  ).run({ ...next, workingDays: JSON.stringify(next.workingDays) });

  return next;
}

function assertWorkingDays(value: unknown): Weekday[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('workingDays must be a non-empty array of weekday indices');
  }
  const days = value.map((d) => assertWeekday(d, 'workingDays[]'));
  // Duplicates are harmless — normalise to a sorted, unique set.
  return [...new Set(days)].sort((a, b) => a - b) as Weekday[];
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** Optional non-empty string, or null to clear it (Jira link / avatar URL). */
function nullableTrimmed(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function createMember(
  db: Db,
  input: {
    teamId: unknown; name: unknown; baseVelocity: unknown; active?: unknown;
    jiraAccountId?: unknown; avatarUrl?: unknown;
  },
): TeamMember {
  const teamId = assertNonEmptyString(input.teamId, 'teamId');
  requireTeam(db, teamId);
  const member: TeamMember = {
    id: newId('mem'),
    teamId,
    name: assertNonEmptyString(input.name, 'name'),
    baseVelocity: assertNumber(input.baseVelocity, 'baseVelocity', { min: 0 }),
    active: input.active === undefined ? true : Boolean(input.active),
    jiraAccountId: nullableTrimmed(input.jiraAccountId, 'jiraAccountId'),
    avatarUrl: nullableTrimmed(input.avatarUrl, 'avatarUrl'),
  };
  db.prepare(
    `INSERT INTO team_member (id, team_id, name, base_velocity, active, jira_account_id, avatar_url)
     VALUES (@id, @teamId, @name, @baseVelocity, @active, @jiraAccountId, @avatarUrl)`,
  ).run({ ...member, active: member.active ? 1 : 0 });
  return member;
}

export function updateMember(
  db: Db,
  id: string,
  patch: { name?: unknown; baseVelocity?: unknown; active?: unknown; jiraAccountId?: unknown; avatarUrl?: unknown },
): TeamMember {
  requireMember(db, id);
  const current = memberRow(db.prepare('SELECT * FROM team_member WHERE id = ?').get(id));
  const next: TeamMember = { ...current };
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name');
  if (patch.baseVelocity !== undefined) {
    next.baseVelocity = assertNumber(patch.baseVelocity, 'baseVelocity', { min: 0 });
  }
  if (patch.active !== undefined) next.active = Boolean(patch.active);
  if (patch.jiraAccountId !== undefined) next.jiraAccountId = nullableTrimmed(patch.jiraAccountId, 'jiraAccountId');
  if (patch.avatarUrl !== undefined) next.avatarUrl = nullableTrimmed(patch.avatarUrl, 'avatarUrl');
  db.prepare(
    `UPDATE team_member SET name = @name, base_velocity = @baseVelocity, active = @active,
       jira_account_id = @jiraAccountId, avatar_url = @avatarUrl WHERE id = @id`,
  ).run({
    ...next,
    active: next.active ? 1 : 0,
    jiraAccountId: next.jiraAccountId ?? null,
    avatarUrl: next.avatarUrl ?? null,
  });
  return next;
}

/** Delete a member. Cascades remove their PTO/on-call/velocity overrides; work
 * items they were assigned to become unassigned (FK ON DELETE SET NULL). */
export function deleteMember(db: Db, id: string): void {
  requireMember(db, id);
  if (memberHasBandwidthHistory(db, id)) {
    throw conflict('Cannot delete a member with bandwidth check-in history; deactivate the member instead.');
  }
  db.transaction(() => {
    db.prepare('DELETE FROM team_member WHERE id = ?').run(id);
    // ON DELETE CASCADE removes expertise entries. Compact every affected list
    // so its next SME is promoted to owner (rank zero).
    const keys = db.prepare('SELECT DISTINCT epic_key FROM epic_sme').all() as { epic_key: string }[];
    const rewrite = db.prepare('UPDATE epic_sme SET rank = ? WHERE epic_key = ? AND member_id = ?');
    for (const { epic_key } of keys) {
      const rows = db.prepare('SELECT member_id FROM epic_sme WHERE epic_key = ? ORDER BY rank, member_id').all(epic_key) as { member_id: string }[];
      rows.forEach((row, rank) => rewrite.run(rank, epic_key, row.member_id));
    }
  })();
}

/** Atomically replace an epic's owner-first SME list. */
export function replaceEpicSmes(db: Db, epicKey: string, input: { memberIds?: unknown; [key: string]: unknown }) {
  requireEpic(db, epicKey);
  if (Object.keys(input).some((key) => key !== 'memberIds') || !Array.isArray(input.memberIds) || !input.memberIds.every((id) => typeof id === 'string')) {
    throw badRequest('memberIds must be an array of strings and no other fields are allowed');
  }
  const memberIds = input.memberIds as string[];
  if (new Set(memberIds).size !== memberIds.length) throw badRequest('memberIds must not contain duplicates');
  const epic = db.prepare('SELECT team_id FROM epic WHERE key = ?').get(epicKey) as { team_id: string };
  const replace = db.transaction(() => {
    for (const memberId of memberIds) {
      const member = db.prepare('SELECT team_id FROM team_member WHERE id = ?').get(memberId) as { team_id: string } | undefined;
      if (!member) throw notFound(`Member ${memberId} not found`);
      if (member.team_id !== epic.team_id) throw badRequest(`Member ${memberId} is not on this epic's team`);
    }
    db.prepare('DELETE FROM epic_sme WHERE epic_key = ?').run(epicKey);
    const insert = db.prepare('INSERT INTO epic_sme (epic_key, member_id, rank) VALUES (?, ?, ?)');
    memberIds.forEach((memberId, rank) => insert.run(epicKey, memberId, rank));
  });
  replace();
  return memberIds.map((memberId, rank) => ({ epicKey, memberId, rank }));
}

// ---------------------------------------------------------------------------
// Member date-range modifiers: PTO, on-call, velocity overrides
// ---------------------------------------------------------------------------

export function createPto(
  db: Db,
  input: { memberId: unknown; startDate: unknown; endDate: unknown; note?: unknown },
): Pto {
  const memberId = assertNonEmptyString(input.memberId, 'memberId');
  requireMember(db, memberId);
  const startDate = assertIsoDate(input.startDate, 'startDate');
  const endDate = assertIsoDate(input.endDate, 'endDate');
  assertDateOrder(startDate, endDate);
  const pto: Pto = { id: newId('pto'), memberId, startDate, endDate, note: noteOf(input.note) };
  db.prepare(
    `INSERT INTO pto (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  ).run(pto);
  return pto;
}

export function deletePto(db: Db, id: string): void {
  if (db.prepare('DELETE FROM pto WHERE id = ?').run(id).changes === 0) {
    throw notFound(`PTO ${id} not found`);
  }
}

export function createOncall(
  db: Db,
  input: { memberId: unknown; startDate: unknown; endDate: unknown; note?: unknown },
): Oncall {
  const memberId = assertNonEmptyString(input.memberId, 'memberId');
  requireMember(db, memberId);
  const startDate = assertIsoDate(input.startDate, 'startDate');
  const endDate = assertIsoDate(input.endDate, 'endDate');
  assertDateOrder(startDate, endDate);
  const oncall: Oncall = { id: newId('oc'), memberId, startDate, endDate, note: noteOf(input.note) };
  db.prepare(
    `INSERT INTO oncall (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  ).run(oncall);
  return oncall;
}

export function deleteOncall(db: Db, id: string): void {
  if (db.prepare('DELETE FROM oncall WHERE id = ?').run(id).changes === 0) {
    throw notFound(`On-call ${id} not found`);
  }
}

export function createVelocityOverride(
  db: Db,
  input: { memberId: unknown; startDate: unknown; endDate: unknown; multiplier: unknown; note?: unknown },
): VelocityOverride {
  const memberId = assertNonEmptyString(input.memberId, 'memberId');
  requireMember(db, memberId);
  const startDate = assertIsoDate(input.startDate, 'startDate');
  const endDate = assertIsoDate(input.endDate, 'endDate');
  assertDateOrder(startDate, endDate);
  const vo: VelocityOverride = {
    id: newId('vo'),
    memberId,
    startDate,
    endDate,
    multiplier: assertNumber(input.multiplier, 'multiplier', { min: 0 }),
    note: noteOf(input.note),
  };
  db.prepare(
    `INSERT INTO velocity_override (id, member_id, start_date, end_date, multiplier, note)
     VALUES (@id, @memberId, @startDate, @endDate, @multiplier, @note)`,
  ).run(vo);
  return vo;
}

export function deleteVelocityOverride(db: Db, id: string): void {
  if (db.prepare('DELETE FROM velocity_override WHERE id = ?').run(id).changes === 0) {
    throw notFound(`Velocity override ${id} not found`);
  }
}

// ---------------------------------------------------------------------------
// Epic milestones ("relevant days") — exactly one gating per epic
// ---------------------------------------------------------------------------

function clearGating(db: Db, epicKey: string, exceptId?: string): void {
  db.prepare(
    `UPDATE epic_milestone SET is_gating = 0 WHERE epic_key = ? AND id != ?`,
  ).run(epicKey, exceptId ?? '');
}

export function createMilestone(
  db: Db,
  epicKey: string,
  input: { name: unknown; date: unknown; isGating?: unknown },
): EpicMilestone {
  requireEpic(db, epicKey);
  const milestone: EpicMilestone = {
    id: newId('ms'),
    epicKey,
    name: assertNonEmptyString(input.name, 'name'),
    date: assertIsoDate(input.date, 'date'),
    // A first relevant day is the useful default target. Explicitly supplied
    // true still promotes a new day when one already exists.
    isGating: input.isGating === undefined
      ? (db.prepare('SELECT COUNT(*) AS n FROM epic_milestone WHERE epic_key = ?').get(epicKey) as { n: number }).n === 0
      : Boolean(input.isGating),
  };
  const run = db.transaction(() => {
    if (milestone.isGating) clearGating(db, epicKey, milestone.id);
    db.prepare(
      `INSERT INTO epic_milestone (id, epic_key, name, date, is_gating)
       VALUES (@id, @epicKey, @name, @date, @isGating)`,
    ).run({ ...milestone, isGating: milestone.isGating ? 1 : 0 });
  });
  run();
  return milestone;
}

export function updateMilestone(
  db: Db,
  id: string,
  patch: { name?: unknown; date?: unknown; isGating?: unknown },
): EpicMilestone {
  const row = db.prepare('SELECT * FROM epic_milestone WHERE id = ?').get(id);
  if (!row) throw notFound(`Milestone ${id} not found`);
  const current = milestoneRow(row);
  const next: EpicMilestone = { ...current };
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name');
  if (patch.date !== undefined) next.date = assertIsoDate(patch.date, 'date');
  if (patch.isGating !== undefined) {
    const wanted = Boolean(patch.isGating);
    // An epic must always keep exactly one gating day; demote via promotion.
    if (current.isGating && !wanted) {
      throw conflict('An epic must have a gating milestone; mark another as gating instead');
    }
    next.isGating = wanted;
  }
  const run = db.transaction(() => {
    if (next.isGating) clearGating(db, next.epicKey, id);
    db.prepare(
      `UPDATE epic_milestone SET name = @name, date = @date, is_gating = @isGating WHERE id = @id`,
    ).run({ ...next, isGating: next.isGating ? 1 : 0 });
  });
  run();
  return next;
}

export function deleteMilestone(db: Db, id: string): void {
  const row = db.prepare('SELECT * FROM epic_milestone WHERE id = ?').get(id);
  if (!row) throw notFound(`Milestone ${id} not found`);
  if (milestoneRow(row).isGating) {
    throw conflict('Cannot delete the gating milestone; mark another as gating first');
  }
  db.prepare('DELETE FROM epic_milestone WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Portfolio-global important dates
// ---------------------------------------------------------------------------
export function createImportantDate(db: Db, input: { name: unknown; date: unknown; iconKey: unknown; notes?: unknown; linkUrl?: unknown }): GlobalImportantDate {
  if (Object.keys(input).some((key) => !['name', 'date', 'iconKey', 'notes', 'linkUrl'].includes(key))) throw badRequest('Unknown important date field');
  const date: GlobalImportantDate = { id: newId('date'), name: assertNonEmptyString(input.name, 'name').trim().slice(0, 160), date: assertIsoDate(input.date, 'date'), iconKey: assertImportantDateIcon(input.iconKey), notes: importantDateNotes(input.notes), linkUrl: importantDateLink(input.linkUrl) };
  db.prepare('INSERT INTO global_important_date (id, name, date, icon_key, notes, link_url) VALUES (@id, @name, @date, @iconKey, @notes, @linkUrl)').run(date);
  return date;
}

export function updateImportantDate(db: Db, id: string, patch: { name?: unknown; date?: unknown; iconKey?: unknown; notes?: unknown; linkUrl?: unknown }): GlobalImportantDate {
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !['name', 'date', 'iconKey', 'notes', 'linkUrl'].includes(key))) throw badRequest('Important date update must contain known fields');
  const row = db.prepare('SELECT * FROM global_important_date WHERE id = ?').get(id);
  if (!row) throw notFound(`Important date ${id} not found`);
  const next = importantDateRow(row);
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name').trim().slice(0, 160);
  if (patch.date !== undefined) next.date = assertIsoDate(patch.date, 'date');
  if (patch.iconKey !== undefined) next.iconKey = assertImportantDateIcon(patch.iconKey);
  if (patch.notes !== undefined) next.notes = importantDateNotes(patch.notes);
  if (patch.linkUrl !== undefined) next.linkUrl = importantDateLink(patch.linkUrl);
  db.prepare('UPDATE global_important_date SET name = @name, date = @date, icon_key = @iconKey, notes = @notes, link_url = @linkUrl WHERE id = @id').run(next);
  return next;
}

export function deleteImportantDate(db: Db, id: string): void {
  if (db.prepare('DELETE FROM global_important_date WHERE id = ?').run(id).changes === 0) throw notFound(`Important date ${id} not found`);
}

// ---------------------------------------------------------------------------
// Gantt Planner: week placements (project plan §6a)
// ---------------------------------------------------------------------------

const placementRow = (r: any): PlannedPlacement => ({
  id: r.id,
  workItemKey: r.work_item_key,
  sprintId: r.sprint_id,
  weekIndex: r.week_index,
});

/** Number of 7-day weeks a sprint spans (the last may be short). */
function weekCount(startDate: IsoDate, endDate: IsoDate): number {
  return Math.max(1, Math.ceil((diffDays(startDate, endDate) + 1) / 7));
}

/**
 * Place a work item into a sprint week (or move it there). Idempotent per work
 * item: the unique `work_item_key` means re-placing replaces the prior slot.
 * Validates that the item and sprint exist and the week is within the sprint.
 */
export function upsertPlacement(
  db: Db,
  input: { workItemKey?: unknown; sprintId?: unknown; weekIndex?: unknown },
): PlannedPlacement {
  const workItemKey = assertNonEmptyString(input.workItemKey, 'workItemKey');
  const sprintId = assertNonEmptyString(input.sprintId, 'sprintId');
  const weekIndex = assertNumber(input.weekIndex, 'weekIndex', { int: true, min: 0 });

  const item = db.prepare('SELECT key FROM work_item WHERE key = ?').get(workItemKey);
  if (!item) throw notFound(`Work item ${workItemKey} not found`);
  const sprint = db.prepare('SELECT * FROM sprint WHERE id = ?').get(sprintId) as
    | { start_date: string; end_date: string }
    | undefined;
  if (!sprint) throw notFound(`Sprint ${sprintId} not found`);

  const weeks = weekCount(sprint.start_date, sprint.end_date);
  if (weekIndex >= weeks) {
    throw badRequest(`weekIndex ${weekIndex} is out of range (sprint has ${weeks} week(s))`);
  }

  const existing = db
    .prepare('SELECT id FROM planned_placement WHERE work_item_key = ?')
    .get(workItemKey) as { id: string } | undefined;
  const id = existing?.id ?? newId('pp');
  db.prepare(
    `INSERT INTO planned_placement (id, work_item_key, sprint_id, week_index)
     VALUES (@id, @workItemKey, @sprintId, @weekIndex)
     ON CONFLICT(work_item_key) DO UPDATE SET sprint_id = @sprintId, week_index = @weekIndex`,
  ).run({ id, workItemKey, sprintId, weekIndex });

  return placementRow(
    db.prepare('SELECT * FROM planned_placement WHERE work_item_key = ?').get(workItemKey),
  );
}

/** Remove a work item's placement (send it back to the backlog bag). */
export function deletePlacement(db: Db, workItemKey: string): void {
  const info = db.prepare('DELETE FROM planned_placement WHERE work_item_key = ?').run(workItemKey);
  if (info.changes === 0) throw notFound(`No placement for work item ${workItemKey}`);
}
