/** Durable, focused persistence for the resumable standup workflow. */
import { randomUUID } from 'node:crypto';
import type { BandwidthCheckIn, StandupMemberTicketContext, StandupNote, StandupParticipant, StandupParticipantDisposition, StandupSession } from '@ecp/shared';
import { deleteBandwidthCheckIn, upsertBandwidthCheckIn } from './bandwidth.js';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_LENGTH = 4_000;
const dispositions = new Set<StandupParticipantDisposition>(['completed', 'skipped']);
const now = () => new Date().toISOString();

export interface StandupAggregate { session: StandupSession; participants: StandupParticipant[]; notes: StandupNote[]; checkIns: BandwidthCheckIn[]; }

function dateOf(value: unknown): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw badRequest('date must be an ISO date (YYYY-MM-DD)');
  return value;
}
function expectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw badRequest('expectedRevision must be a non-negative integer');
  return value as number;
}
function sessionRow(row: any): StandupSession {
  return { id: row.id, teamId: row.team_id, date: row.standup_date, sprintId: row.sprint_id ?? null, sprintName: row.sprint_name ?? null, status: row.status, startedAt: row.started_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? null, committedAt: row.committed_at ?? null, revision: row.revision };
}
function participantRow(row: any): StandupParticipant {
  return { sessionId: row.session_id, memberId: row.member_id, memberName: row.member_name, position: row.position, disposition: row.disposition, resolvedAt: row.resolved_at ?? null };
}
function getSessionRow(db: Db, id: string): any {
  const row = db.prepare('SELECT * FROM standup_session WHERE id = ?').get(id);
  if (!row) throw notFound(`Standup session ${id} not found`);
  return row;
}
function notesFor(db: Db, sessionId: string): StandupNote[] {
  const rows = db.prepare('SELECT * FROM standup_note WHERE session_id = ? ORDER BY position').all(sessionId) as any[];
  const members = db.prepare('SELECT member_id FROM standup_note_member WHERE note_id = ? ORDER BY member_id');
  return rows.map((row) => ({ id: row.id, sessionId: row.session_id, body: row.body, allTeam: row.all_team === 1, memberIds: members.all(row.id).map((entry: any) => entry.member_id), position: row.position, createdAt: row.created_at, updatedAt: row.updated_at }));
}
export function getStandup(db: Db, id: string): StandupAggregate {
  const row = getSessionRow(db, id);
  const checkIns = db.prepare('SELECT * FROM bandwidth_check_in WHERE session_id = ? ORDER BY member_id').all(id).map((entry: any) => ({ memberId: entry.member_id, date: entry.check_in_date, sessionId: entry.session_id, feeling: entry.feeling, note: entry.note ?? null, createdAt: entry.created_at, updatedAt: entry.updated_at }));
  return { session: sessionRow(row), participants: db.prepare('SELECT * FROM standup_participant WHERE session_id = ? ORDER BY position').all(id).map(participantRow), notes: notesFor(db, id), checkIns };
}
export function listStandups(db: Db, teamId: string): StandupSession[] { return db.prepare('SELECT * FROM standup_session WHERE team_id = ? ORDER BY standup_date DESC, started_at DESC').all(teamId).map(sessionRow); }

export function standupMemberJiraContext(db: Db, sessionId: string, memberId: string): { sprintId: string | null; jiraAccountId: string | null } {
  const row = db.prepare(`SELECT s.sprint_id, m.jira_account_id
    FROM standup_session s JOIN standup_participant p ON p.session_id = s.id
    JOIN team_member m ON m.id = p.member_id WHERE s.id = ? AND p.member_id = ?`).get(sessionId, memberId) as any;
  if (!row) throw notFound(`Participant ${memberId} not found in standup ${sessionId}`);
  return { sprintId: row.sprint_id ?? null, jiraAccountId: row.jira_account_id ?? null };
}

export function saveMemberTicketContext(db: Db, sessionId: string, context: StandupMemberTicketContext): void {
  getSessionRow(db, sessionId);
  db.prepare(`INSERT INTO standup_context_snapshot (session_id, scope_kind, scope_key, captured_at, source, fetch_status, error_message, payload_json)
    VALUES (?, 'member', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, scope_kind, scope_key) DO UPDATE SET captured_at = excluded.captured_at, source = excluded.source,
      fetch_status = excluded.fetch_status, error_message = excluded.error_message, payload_json = excluded.payload_json`)
    .run(sessionId, context.memberId, context.capturedAt, context.source, context.freshness, context.errorMessage, JSON.stringify(context));
}

export function getMemberTicketContext(db: Db, sessionId: string, memberId: string): StandupMemberTicketContext | null {
  const row = db.prepare("SELECT payload_json FROM standup_context_snapshot WHERE session_id = ? AND scope_kind = 'member' AND scope_key = ?").get(sessionId, memberId) as any;
  if (!row) return null;
  try { return JSON.parse(row.payload_json) as StandupMemberTicketContext; } catch { return null; }
}

/** Idempotently starts one local-calendar-day session and snapshots active roster order. */
export function startStandup(db: Db, input: { teamId?: unknown; date?: unknown }): StandupAggregate {
  if (typeof input.teamId !== 'string' || !input.teamId) throw badRequest('teamId is required');
  const date = dateOf(input.date);
  const existing = db.prepare('SELECT id FROM standup_session WHERE team_id = ? AND standup_date = ?').get(input.teamId, date) as any;
  if (existing) return getStandup(db, existing.id);
  const create = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM team WHERE id = ?').get(input.teamId)) throw notFound(`Team ${input.teamId} not found`);
    const again = db.prepare('SELECT id FROM standup_session WHERE team_id = ? AND standup_date = ?').get(input.teamId, date) as any;
    if (again) return again.id;
    const timestamp = now(); const id = `standup_${randomUUID()}`;
    const sprint = db.prepare('SELECT id, name FROM sprint WHERE team_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1').get(input.teamId, date, date) as any;
    db.prepare(`INSERT INTO standup_session (id, team_id, standup_date, sprint_id, sprint_name, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(id, input.teamId, date, sprint?.id ?? null, sprint?.name ?? null, timestamp, timestamp);
    const members = db.prepare('SELECT id, name FROM team_member WHERE team_id = ? AND active = 1 ORDER BY name COLLATE NOCASE, id').all(input.teamId) as any[];
    const insert = db.prepare('INSERT INTO standup_participant (session_id, member_id, member_name, position) VALUES (?, ?, ?, ?)');
    members.forEach((member, position) => insert.run(id, member.id, member.name, position));
    if (members.length === 0) db.prepare("UPDATE standup_session SET status = 'post_standup', updated_at = ?, revision = 1 WHERE id = ?").run(timestamp, id);
    return id;
  });
  return getStandup(db, create());
}

function assertMutable(row: any, revision: number): void {
  if (row.status === 'completed' || row.committed_at) throw conflict('Completed or committed standups are read-only');
  if (row.revision !== revision) throw conflict('This standup changed in another tab; reload and try again');
}
function touch(db: Db, id: string): void { db.prepare('UPDATE standup_session SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now(), id); }

export function resolveParticipant(db: Db, sessionId: string, memberId: string, input: { disposition?: unknown; expectedRevision?: unknown }): StandupAggregate {
  if (!dispositions.has(input.disposition as StandupParticipantDisposition)) throw badRequest('disposition must be completed or skipped');
  const revision = expectedRevision(input.expectedRevision);
  db.transaction(() => {
    const row = getSessionRow(db, sessionId); assertMutable(row, revision);
    if (row.status !== 'active') throw conflict('Participants can only be resolved during the team round');
    const current = db.prepare("SELECT * FROM standup_participant WHERE session_id = ? AND disposition = 'pending' ORDER BY position LIMIT 1").get(sessionId) as any;
    if (!current || current.member_id !== memberId) throw conflict('Only the current pending participant can be resolved');
    db.prepare('UPDATE standup_participant SET disposition = ?, resolved_at = ? WHERE session_id = ? AND member_id = ?').run(input.disposition, now(), sessionId, memberId);
    const pending = db.prepare("SELECT 1 FROM standup_participant WHERE session_id = ? AND disposition = 'pending' LIMIT 1").get(sessionId);
    if (!pending) db.prepare("UPDATE standup_session SET status = 'post_standup' WHERE id = ?").run(sessionId);
    touch(db, sessionId);
  })();
  return getStandup(db, sessionId);
}

function audience(db: Db, sessionId: string, value: any): { allTeam: boolean; memberIds: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('audience is required');
  if (Object.keys(value).some((key) => key !== 'allTeam' && key !== 'memberIds')) throw badRequest('Unknown audience field');
  if (typeof value.allTeam !== 'boolean' || !Array.isArray(value.memberIds) || value.memberIds.some((id: unknown) => typeof id !== 'string')) throw badRequest('audience must contain allTeam and memberIds');
  const memberIds = [...new Set(value.memberIds as string[])];
  if (value.allTeam && memberIds.length) throw badRequest('All team cannot be combined with member tags');
  const teamId = getSessionRow(db, sessionId).team_id;
  for (const memberId of memberIds) if (!db.prepare('SELECT 1 FROM team_member WHERE id = ? AND team_id = ?').get(memberId, teamId)) throw badRequest('Tagged members must belong to the standup team');
  return { allTeam: value.allTeam, memberIds };
}
function body(value: unknown): string { if (typeof value !== 'string') throw badRequest('body must be a string'); const trimmed = value.trim(); if (!trimmed) throw badRequest('body must not be empty'); if (trimmed.length > MAX_NOTE_LENGTH) throw badRequest(`body must be at most ${MAX_NOTE_LENGTH} characters`); return trimmed; }
function writeAudience(db: Db, noteId: string, memberIds: string[]): void { db.prepare('DELETE FROM standup_note_member WHERE note_id = ?').run(noteId); const insert = db.prepare('INSERT INTO standup_note_member (note_id, member_id) VALUES (?, ?)'); memberIds.forEach((id) => insert.run(noteId, id)); }

export function createNote(db: Db, sessionId: string, input: any): StandupAggregate {
  db.transaction(() => { const row = getSessionRow(db, sessionId); assertMutable(row, expectedRevision(input?.expectedRevision)); const text = body(input?.body); const selected = audience(db, sessionId, input?.audience); const timestamp = now(); const id = `standup_note_${randomUUID()}`; const position = (db.prepare('SELECT COUNT(*) AS n FROM standup_note WHERE session_id = ?').get(sessionId) as any).n; db.prepare('INSERT INTO standup_note (id, session_id, body, all_team, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, text, selected.allTeam ? 1 : 0, position, timestamp, timestamp); writeAudience(db, id, selected.memberIds); touch(db, sessionId); })();
  return getStandup(db, sessionId);
}
export function updateNote(db: Db, sessionId: string, noteId: string, input: any): StandupAggregate {
  db.transaction(() => { const row = getSessionRow(db, sessionId); assertMutable(row, expectedRevision(input?.expectedRevision)); if (!db.prepare('SELECT 1 FROM standup_note WHERE id = ? AND session_id = ?').get(noteId, sessionId)) throw notFound(`Standup note ${noteId} not found`); const text = body(input?.body); const selected = audience(db, sessionId, input?.audience); db.prepare('UPDATE standup_note SET body = ?, all_team = ?, updated_at = ? WHERE id = ?').run(text, selected.allTeam ? 1 : 0, now(), noteId); writeAudience(db, noteId, selected.memberIds); touch(db, sessionId); })();
  return getStandup(db, sessionId);
}
export function deleteNote(db: Db, sessionId: string, noteId: string, input: any): StandupAggregate {
  db.transaction(() => { const row = getSessionRow(db, sessionId); assertMutable(row, expectedRevision(input?.expectedRevision)); if (db.prepare('DELETE FROM standup_note WHERE id = ? AND session_id = ?').run(noteId, sessionId).changes !== 1) throw notFound(`Standup note ${noteId} not found`); const rows = db.prepare('SELECT id FROM standup_note WHERE session_id = ? ORDER BY position').all(sessionId) as any[]; const set = db.prepare('UPDATE standup_note SET position = ? WHERE id = ?'); rows.forEach((entry, index) => set.run(index, entry.id)); touch(db, sessionId); })();
  return getStandup(db, sessionId);
}

export function upsertCheckIn(db: Db, sessionId: string, memberId: string, input: any): BandwidthCheckIn {
  const row = getSessionRow(db, sessionId); if (row.status !== 'active' || row.committed_at) throw conflict('Check-ins can only change during an active standup');
  if (!db.prepare('SELECT 1 FROM standup_participant WHERE session_id = ? AND member_id = ?').get(sessionId, memberId)) throw notFound(`Participant ${memberId} not found in standup ${sessionId}`);
  return upsertBandwidthCheckIn(db, memberId, row.standup_date, { ...input, sessionId });
}
export function deleteCheckIn(db: Db, sessionId: string, memberId: string): void { const row = getSessionRow(db, sessionId); if (row.status !== 'active' || row.committed_at) throw conflict('Check-ins can only change during an active standup'); deleteBandwidthCheckIn(db, memberId, row.standup_date); }
export function commitStandup(db: Db, sessionId: string): StandupAggregate { const row = getSessionRow(db, sessionId); if (row.status !== 'completed') throw conflict('Finish Standup before committing it'); if (!row.committed_at) db.prepare('UPDATE standup_session SET committed_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?').run(now(), now(), sessionId); return getStandup(db, sessionId); }
export function deleteStandup(db: Db, sessionId: string): void { db.transaction(() => { const row = getSessionRow(db, sessionId); db.prepare('DELETE FROM bandwidth_check_in WHERE session_id = ?').run(sessionId); db.prepare('DELETE FROM standup_session WHERE id = ?').run(row.id); })(); }

export function finishStandup(db: Db, sessionId: string, input: any): StandupAggregate {
  db.transaction(() => { const row = getSessionRow(db, sessionId); const revision = expectedRevision(input?.expectedRevision); if (row.status === 'completed') { if (row.revision !== revision) throw conflict('This standup changed in another tab; reload and try again'); return; } assertMutable(row, revision); if (row.status !== 'post_standup') throw conflict('Finish Standup is available after all participants are resolved'); const aggregate = getStandup(db, sessionId); const snapshot = { schemaVersion: 1, ...aggregate, completedAt: now() }; db.prepare("UPDATE standup_session SET status = 'completed', completed_at = ?, updated_at = ?, revision = revision + 1, final_schema_version = 1, final_snapshot_json = ? WHERE id = ?").run(snapshot.completedAt, snapshot.completedAt, JSON.stringify(snapshot), sessionId); })();
  return getStandup(db, sessionId);
}
