import { randomUUID } from 'node:crypto';
import type { TeamHoliday } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, notFound } from '../http-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const row = (value: any): TeamHoliday => ({ id: value.id, teamId: value.team_id, date: value.date, name: value.name });

function date(value: unknown): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) throw badRequest('date must be an ISO date (YYYY-MM-DD)');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('name must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) throw badRequest('name must be 1–160 characters');
  return trimmed;
}
function assertTeam(db: Db, teamId: string): void {
  if (!db.prepare('SELECT 1 FROM team WHERE id = ?').get(teamId)) throw notFound(`Team ${teamId} not found`);
}

export function listHolidays(db: Db, teamId: string, range: { start?: string; end?: string } = {}): TeamHoliday[] {
  assertTeam(db, teamId);
  return db.prepare('SELECT * FROM team_holiday WHERE team_id = ? AND (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?) ORDER BY date, name COLLATE NOCASE, id')
    .all(teamId, range.start ?? null, range.start ?? null, range.end ?? null, range.end ?? null).map(row);
}
export function createHoliday(db: Db, teamId: string, input: unknown): TeamHoliday {
  assertTeam(db, teamId); const body = (input ?? {}) as Record<string, unknown>; const result = { id: `holiday_${randomUUID().slice(0, 8)}`, teamId, date: date(body.date), name: name(body.name) };
  try { db.prepare('INSERT INTO team_holiday (id, team_id, date, name) VALUES (?, ?, ?, ?)').run(result.id, result.teamId, result.date, result.name); } catch { throw badRequest('A holiday with that name and date already exists for this team'); }
  return result;
}
export function updateHoliday(db: Db, teamId: string, id: string, input: unknown): TeamHoliday {
  assertTeam(db, teamId); const existing = db.prepare('SELECT * FROM team_holiday WHERE id = ? AND team_id = ?').get(id, teamId) as { date: string; name: string } | undefined; if (!existing) throw notFound(`Holiday ${id} not found`);
  const body = (input ?? {}) as Record<string, unknown>; const result = { id, teamId, date: body.date === undefined ? existing.date : date(body.date), name: body.name === undefined ? existing.name : name(body.name) };
  try { db.prepare('UPDATE team_holiday SET date = ?, name = ? WHERE id = ?').run(result.date, result.name, id); } catch { throw badRequest('A holiday with that name and date already exists for this team'); }
  return result;
}
export function deleteHoliday(db: Db, teamId: string, id: string): void {
  assertTeam(db, teamId); if (db.prepare('DELETE FROM team_holiday WHERE id = ? AND team_id = ?').run(id, teamId).changes === 0) throw notFound(`Holiday ${id} not found`);
}
