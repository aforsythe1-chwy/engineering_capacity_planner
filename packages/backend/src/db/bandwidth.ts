/** Local persistence operations for daily team bandwidth check-ins. */
import type { BandwidthCheckIn, BandwidthFeeling, IsoDate } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, notFound } from '../http-error.js';

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

export function listBandwidthCheckIns(db: Db, input: { teamId?: unknown; from?: unknown; to?: unknown }): BandwidthCheckIn[] {
  if (typeof input.teamId !== 'string' || !input.teamId) throw badRequest('teamId is required');
  if (!db.prepare('SELECT 1 FROM team WHERE id = ?').get(input.teamId)) throw notFound(`Team ${input.teamId} not found`);
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
  ).all(input.teamId, from, to).map(rowToCheckIn);
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
       session_id = excluded.session_id, feeling = excluded.feeling, note = excluded.note, updated_at = excluded.updated_at`,
  ).run(memberId, checkInDate, input.sessionId ?? null, input.feeling, note, now, now);
  return rowToCheckIn(db.prepare(
    'SELECT * FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ?',
  ).get(memberId, checkInDate));
}

export function deleteBandwidthCheckIn(db: Db, memberId: string, date: string): void {
  requireMember(db, memberId);
  db.prepare('DELETE FROM bandwidth_check_in WHERE member_id = ? AND check_in_date = ?').run(memberId, dateOf(date, 'date'));
}

export function memberHasBandwidthHistory(db: Db, memberId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM bandwidth_check_in WHERE member_id = ? LIMIT 1').get(memberId));
}
