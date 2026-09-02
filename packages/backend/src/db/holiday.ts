import { randomUUID } from 'node:crypto';
import { assertAnnualHolidayRecurrence, holidayOccurrenceForYear, type AnnualHolidayRecurrence, type TeamHoliday } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';

type Row = { id: string; team_id: string; date: string | null; name: string; recurrence_kind: string | null; month: number | null; day: number | null; weekday: number | null; ordinal: string | null; observed_policy: string | null };
type HolidayInput = { name?: unknown; recurrence?: unknown };
const now = () => new Date().toISOString();

function row(value: Row): TeamHoliday {
  if (value.recurrence_kind === 'fixed-date') return { id: value.id, teamId: value.team_id, name: value.name, recurrence: { kind: 'fixed-date', month: value.month!, day: value.day!, observedPolicy: value.observed_policy === 'nearest-weekday' ? 'nearest-weekday' : 'none' } };
  if (value.recurrence_kind === 'nth-weekday') return { id: value.id, teamId: value.team_id, name: value.name, recurrence: { kind: 'nth-weekday', month: value.month!, weekday: value.weekday! as 0 | 1 | 2 | 3 | 4 | 5 | 6, ordinal: value.ordinal === 'last' ? 'last' : Number(value.ordinal) as 1 | 2 | 3 | 4, observedPolicy: 'none' } };
  return { id: value.id, teamId: value.team_id, name: value.name, ...(value.date ? { date: value.date } : {}) };
}

function assertTeam(db: Db, teamId: string): void {
  if (!db.prepare('SELECT 1 FROM team WHERE id = ?').get(teamId)) throw notFound(`Team ${teamId} not found`);
}
function name(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('name must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) throw badRequest('name must be 1–160 characters');
  return trimmed;
}
function recurrence(value: unknown): AnnualHolidayRecurrence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('recurrence must be an annual holiday rule');
  const input = value as Record<string, unknown>;
  let candidate: AnnualHolidayRecurrence;
  if (input.kind === 'fixed-date') candidate = { kind: 'fixed-date', month: input.month as number, day: input.day as number, observedPolicy: input.observedPolicy as 'none' | 'nearest-weekday' };
  else if (input.kind === 'nth-weekday') candidate = { kind: 'nth-weekday', month: input.month as number, weekday: input.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6, ordinal: input.ordinal as 1 | 2 | 3 | 4 | 'last', observedPolicy: input.observedPolicy as 'none' };
  else throw badRequest('recurrence.kind must be fixed-date or nth-weekday');
  try { assertAnnualHolidayRecurrence(candidate); } catch (error) { throw badRequest(error instanceof Error ? error.message : 'Invalid holiday recurrence'); }
  return candidate;
}
function assertKnownFields(input: HolidayInput): void {
  if (Object.keys(input).some((key) => key !== 'name' && key !== 'recurrence')) throw badRequest('Unknown holiday field');
}
function anchorDate(holiday: TeamHoliday): string {
  const occurrence = holidayOccurrenceForYear(holiday, 2000);
  if (!occurrence) throw badRequest('Holiday recurrence has no compatibility anchor date');
  return occurrence.date;
}
function sameRecurrence(a: AnnualHolidayRecurrence, b: AnnualHolidayRecurrence): boolean {
  return a.kind === b.kind && a.month === b.month && a.observedPolicy === b.observedPolicy && (a.kind === 'fixed-date' && b.kind === 'fixed-date' ? a.day === b.day : a.kind === 'nth-weekday' && b.kind === 'nth-weekday' ? a.weekday === b.weekday && a.ordinal === b.ordinal : false);
}
function assertUnique(db: Db, teamId: string, candidate: TeamHoliday, exceptId?: string): void {
  const duplicate = (db.prepare('SELECT * FROM team_holiday WHERE team_id = ?').all(teamId) as Row[]).map(row).find((existing) => existing.id !== exceptId && existing.name.localeCompare(candidate.name, undefined, { sensitivity: 'accent' }) === 0 && existing.recurrence && candidate.recurrence && sameRecurrence(existing.recurrence, candidate.recurrence));
  if (duplicate) throw conflict(`A matching holiday rule already exists (${duplicate.name})`);
}
function write(db: Db, holiday: TeamHoliday): TeamHoliday {
  const recurrence = holiday.recurrence!;
  const timestamp = now();
  db.prepare(`INSERT INTO team_holiday (id, team_id, date, name, recurrence_kind, month, day, weekday, ordinal, observed_policy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET date = excluded.date, name = excluded.name, recurrence_kind = excluded.recurrence_kind, month = excluded.month, day = excluded.day, weekday = excluded.weekday, ordinal = excluded.ordinal, observed_policy = excluded.observed_policy, updated_at = excluded.updated_at`)
    .run(holiday.id, holiday.teamId, anchorDate(holiday), holiday.name, recurrence.kind, recurrence.month, recurrence.kind === 'fixed-date' ? recurrence.day : null, recurrence.kind === 'nth-weekday' ? recurrence.weekday : null, recurrence.kind === 'nth-weekday' ? String(recurrence.ordinal) : null, recurrence.observedPolicy, timestamp, timestamp);
  return holiday;
}

export function listHolidays(db: Db, teamId: string): TeamHoliday[] {
  assertTeam(db, teamId);
  return (db.prepare('SELECT * FROM team_holiday WHERE team_id = ? ORDER BY name COLLATE NOCASE, recurrence_kind, month, day, weekday, ordinal, id').all(teamId) as Row[]).map(row);
}
export function createHoliday(db: Db, teamId: string, input: unknown): TeamHoliday {
  assertTeam(db, teamId); const body = (input ?? {}) as HolidayInput; assertKnownFields(body);
  const holiday: TeamHoliday = { id: `holiday_${randomUUID().slice(0, 8)}`, teamId, name: name(body.name), recurrence: recurrence(body.recurrence) };
  assertUnique(db, teamId, holiday); return write(db, holiday);
}
export function updateHoliday(db: Db, teamId: string, id: string, input: unknown): TeamHoliday {
  assertTeam(db, teamId); const body = (input ?? {}) as HolidayInput; assertKnownFields(body);
  const existing = db.prepare('SELECT * FROM team_holiday WHERE id = ? AND team_id = ?').get(id, teamId) as Row | undefined; if (!existing) throw notFound(`Holiday ${id} not found`);
  const current = row(existing); if (!current.recurrence) throw badRequest('Holiday must be migrated before it can be edited');
  const holiday: TeamHoliday = { id, teamId, name: body.name === undefined ? current.name : name(body.name), recurrence: body.recurrence === undefined ? current.recurrence : recurrence(body.recurrence) };
  assertUnique(db, teamId, holiday, id); return write(db, holiday);
}
export function deleteHoliday(db: Db, teamId: string, id: string): void {
  assertTeam(db, teamId); if (db.prepare('DELETE FROM team_holiday WHERE id = ? AND team_id = ?').run(id, teamId).changes === 0) throw notFound(`Holiday ${id} not found`);
}
