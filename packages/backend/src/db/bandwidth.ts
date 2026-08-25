/** Local persistence operations for daily team bandwidth check-ins. */
import type { BandwidthCheckIn, BandwidthDay, BandwidthDayPatch, BandwidthFeeling, IsoDate } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FEELINGS = new Set<BandwidthFeeling>(['red', 'yellow', 'green', 'purple']);
const MAX_NOTE_LENGTH = 2_000;

function dateOf(value: unknown, field: string): IsoDate {
  if (typeof value !== 'string') throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  const match = ISO_DATE.exec(value);
  if (!match) throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw badRequest(`${field} must be a real calendar date`);
  }
  return value;
}

function noteOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be a string');
  const note = value.trim();
  if (note.length > MAX_NOTE_LENGTH) throw badRequest(`note must be at most ${MAX_NOTE_LENGTH} characters`);
  return note || null;
}

function rowToCheckIn(row: any): BandwidthCheckIn {
  return {
    memberId: row.member_id,
    date: row.check_in_date,
    sessionId: row.session_id ?? null,
    feeling: row.feeling,
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireMember(db: Db, memberId: string): void {
  if (!db.prepare('SELECT 1 FROM team_member WHERE id = ?').get(memberId)) {
    throw notFound(`Member ${memberId} not found`);
  }
}

function requireTeam(db: Db, teamId: unknown): string {
  if (typeof teamId !== 'string' || !teamId) throw badRequest('teamId is required');
  if (!db.prepare('SELECT 1 FROM team WHERE id = ?').get(teamId)) throw notFound(`Team ${teamId} not found`);
  return teamId;
}

function requireTeamMember(db: Db, teamId: string, memberId: unknown): string {
  if (typeof memberId !== 'string' || !memberId) throw badRequest('memberId is required');
  const member = db.prepare('SELECT team_id FROM team_member WHERE id = ?').get(memberId) as { team_id: string } | undefined;
  if (!member) throw notFound(`Member ${memberId} not found`);
  if (member.team_id !== teamId) throw badRequest(`Member ${memberId} does not belong to team ${teamId}`);
  return memberId;
}

function standupForDay(db: Db, teamId: string, date: IsoDate): BandwidthDay['standup'] {
  const session = db.prepare('SELECT id, status FROM standup_session WHERE team_id = ? AND standup_date = ?').get(teamId, date) as any;
  return session ? { sessionId: session.id, status: session.status } : null;
}

function checkInsForDay(db: Db, teamId: string, date: IsoDate): BandwidthCheckIn[] {
  return db.prepare(
    `SELECT b.* FROM bandwidth_check_in b
     JOIN team_member m ON m.id = b.member_id
     WHERE m.team_id = ? AND b.check_in_date = ?
     ORDER BY CASE WHEN m.active = 1 THEN 0 ELSE 1 END, m.name COLLATE NOCASE ASC, b.member_id ASC`,
  ).all(teamId, date).map(rowToCheckIn);
}

function parsePatch(input: unknown): BandwidthDayPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Bandwidth day patch must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'upserts' && key !== 'deleteMemberIds')) throw badRequest('Unknown bandwidth day patch field');
  if (!Array.isArray(value.upserts) || !Array.isArray(value.deleteMemberIds)) throw badRequest('upserts and deleteMemberIds must be arrays');
  const upsertIds = new Set<string>();
  const upserts = value.upserts.map((entry): BandwidthDayPatch['upserts'][number] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw badRequest('Each bandwidth day upsert must be an object');
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== 'memberId' && key !== 'feeling' && key !== 'note')) throw badRequest('Unknown bandwidth day upsert field');
    if (typeof row.memberId !== 'string' || !row.memberId) throw badRequest('memberId is required');
    if (upsertIds.has(row.memberId)) throw badRequest(`Duplicate memberId ${row.memberId}`);
    upsertIds.add(row.memberId);
    if (!FEELINGS.has(row.feeling as BandwidthFeeling)) throw badRequest('feeling must be red, yellow, green, or purple');
    return { memberId: row.memberId, feeling: row.feeling as BandwidthFeeling, note: noteOf(row.note) };
  });
  const deleteIds = new Set<string>();
  const deleteMemberIds = value.deleteMemberIds.map((memberId): string => {
    if (typeof memberId !== 'string' || !memberId) throw badRequest('deleteMemberIds must contain member IDs');
    if (deleteIds.has(memberId)) throw badRequest(`Duplicate memberId ${memberId}`);
    if (upsertIds.has(memberId)) throw badRequest(`Member ${memberId} cannot be upserted and deleted together`);
    deleteIds.add(memberId);
    return memberId;
  });
  if (!upserts.length && !deleteMemberIds.length) throw badRequest('At least one bandwidth day operation is required');
  return { upserts, deleteMemberIds };
}

export function listBandwidthCheckIns(db: Db, input: { teamId?: unknown; from?: unknown; to?: unknown }): BandwidthCheckIn[] {
  const teamId = requireTeam(db, input.teamId);
  const from = dateOf(input.from, 'from');
  const to = dateOf(input.to, 'to');
  if (from > to) throw badRequest('from must be on or before to');
  const rangeDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (rangeDays > 366) throw badRequest('date range must not exceed 366 days');
  return db.prepare(
    `SELECT b.* FROM bandwidth_check_in b
     JOIN team_member m ON m.id = b.member_id
     WHERE m.team_id = ? AND b.check_in_date >= ? AND b.check_in_date <= ?
     ORDER BY b.check_in_date ASC, m.name COLLATE NOCASE ASC, b.member_id ASC`,
  ).all(teamId, from, to).map(rowToCheckIn);
}

/** Returns the complete, authoritative state and ownership of one team day. */
export function getBandwidthDay(db: Db, teamIdInput: unknown, dateInput: unknown): BandwidthDay {
  const teamId = requireTeam(db, teamIdInput);
  const date = dateOf(dateInput, 'date');
  return { teamId, date, checkIns: checkInsForDay(db, teamId, date), standup: standupForDay(db, teamId, date) };
}

/** Atomically applies explicit manual changes without replacing omitted members. */
export function patchBandwidthDay(db: Db, teamIdInput: unknown, dateInput: unknown, input: unknown): BandwidthDay {
  const teamId = requireTeam(db, teamIdInput);
  const date = dateOf(dateInput, 'date');
  const patch = parsePatch(input);
  const memberIds = [...patch.upserts.map((entry) => entry.memberId), ...patch.deleteMemberIds];
  memberIds.forEach((memberId) => requireTeamMember(db, teamId, memberId));
  const apply = db.transaction(() => {
    if (standupForDay(db, teamId, date)) throw conflict('Standup-managed dates are read-only from Team');
    const sessionOwned = db.prepare(`SELECT member_id FROM bandwidth_check_in b
      JOIN team_member m ON m.id = b.member_id
      WHERE m.team_id = ? AND b.check_in_date = ? AND b.session_id IS NOT NULL LIMIT 1`).get(teamId, date) as any;
    if (sessionOwned) throw conflict('Standup-owned check-ins are read-only from Team');
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO bandwidth_check_in (member_id, check_in_date, session_id, feeling, note, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(member_id, check_in_date) DO UPDATE SET
         feeling = excluded.feeling, note = excluded.note, updated_at = excluded.updated_at`,
    );
    for (const entry of patch.upserts) upsert.run(entry.memberId, date, entry.feeling, entry.note ?? null, now, now);
    const existing = db.prepare('SELECT session_id FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ?');
    const remove = db.prepare('DELETE FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ? AND session_id IS NULL');
    for (const memberId of patch.deleteMemberIds) {
      const row = existing.get(memberId, date) as { session_id?: string | null } | undefined;
      if (row?.session_id) throw conflict('Standup-owned check-ins are read-only from Team');
      remove.run(memberId, date);
    }
  });
  apply();
  return getBandwidthDay(db, teamId, date);
}

export function upsertBandwidthCheckIn(
  db: Db,
  memberId: string,
  date: string,
  input: { feeling?: unknown; note?: unknown; sessionId?: string | null; [key: string]: unknown },
): BandwidthCheckIn {
  requireMember(db, memberId);
  const checkInDate = dateOf(date, 'date');
  if (Object.keys(input).some((key) => key !== 'feeling' && key !== 'note' && key !== 'sessionId')) throw badRequest('Unknown bandwidth check-in field');
  if (!FEELINGS.has(input.feeling as BandwidthFeeling)) throw badRequest('feeling must be red, yellow, green, or purple');
  const note = noteOf(input.note);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bandwidth_check_in (member_id, check_in_date, session_id, feeling, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(member_id, check_in_date) DO UPDATE SET
       session_id = CASE WHEN excluded.session_id IS NULL THEN bandwidth_check_in.session_id ELSE excluded.session_id END,
       feeling = excluded.feeling, note = excluded.note, updated_at = excluded.updated_at`,
  ).run(memberId, checkInDate, input.sessionId ?? null, input.feeling, note, now, now);
  return rowToCheckIn(db.prepare(
    'SELECT * FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ?',
  ).get(memberId, checkInDate));
}

export function deleteBandwidthCheckIn(db: Db, memberId: string, date: string): void {
  requireMember(db, memberId);
  const checkInDate = dateOf(date, 'date');
  const row = db.prepare('SELECT session_id FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ?').get(memberId, checkInDate) as { session_id?: string | null } | undefined;
  if (row?.session_id) throw conflict('Standup-owned check-ins must be changed from Standup');
  db.prepare('DELETE FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ?').run(memberId, checkInDate);
}

export function memberHasBandwidthHistory(db: Db, memberId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM bandwidth_check_in WHERE member_id = ? LIMIT 1').get(memberId));
}
