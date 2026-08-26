import { randomUUID } from 'node:crypto';
import type { IntakeAwarenessRecord, IntakeAwarenessConfidence, StandupIntakeContext } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown) => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
function session(db: Db, id: string): any { const row = db.prepare('SELECT id, standup_date, status FROM standup_session WHERE id = ?').get(id); if (!row) throw notFound(`Standup session ${id} not found`); return row; }
export function assertIntakeMutable(db: Db, sessionId: string): void { const row = session(db, sessionId); if (row.status !== 'active' && row.status !== 'post_standup') throw conflict('Completed standups are read-only'); }
function logged(db: Db, context: StandupIntakeContext): StandupIntakeContext {
  const rows = db.prepare(`SELECT jira_key FROM intake_request_awareness WHERE jira_key IN (${context.requests.map(() => '?').join(',') || "''"})`).all(...context.requests.map((item) => item.key)) as any[];
  const keys = new Set(rows.map((row) => row.jira_key));
  return { ...context, requests: context.requests.map((item) => ({ ...item, awarenessLogged: keys.has(item.key) })) };
}
export function getStandupIntakeContext(db: Db, sessionId: string): StandupIntakeContext | null {
  session(db, sessionId); const row = db.prepare("SELECT payload_json FROM standup_context_snapshot WHERE session_id = ? AND scope_kind = 'global' AND scope_key = 'intake_requests'").get(sessionId) as any;
  if (!row) return null;
  try { return logged(db, JSON.parse(row.payload_json) as StandupIntakeContext); } catch { return null; }
}
export function saveStandupIntakeContext(db: Db, sessionId: string, context: StandupIntakeContext): void {
  session(db, sessionId);
  db.prepare(`INSERT INTO standup_context_snapshot (session_id, scope_kind, scope_key, captured_at, source, fetch_status, error_message, payload_json) VALUES (?, 'global', 'intake_requests', ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, scope_kind, scope_key) DO UPDATE SET captured_at=excluded.captured_at, source=excluded.source, fetch_status=excluded.fetch_status, error_message=excluded.error_message, payload_json=excluded.payload_json`)
    .run(sessionId, context.capturedAt, context.source, context.freshness, context.errorMessage, JSON.stringify({ ...context, requests: context.requests.map((item) => ({ ...item, awarenessLogged: false })) }));
}
export function createIntakeAwareness(db: Db, sessionId: string, jiraKey: string, input: any): IntakeAwarenessRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['awareDate', 'dateConfidence', 'notes'].includes(key))) throw badRequest('Unknown awareness field');
  if (!validDate(input.awareDate)) throw badRequest('awareDate must be an ISO date (YYYY-MM-DD)');
  if (!['high', 'medium', 'low'].includes(input.dateConfidence)) throw badRequest('dateConfidence must be high, medium, or low');
  if (input.notes !== undefined && typeof input.notes !== 'string') throw badRequest('notes must be a string');
  const notes = typeof input.notes === 'string' ? input.notes.trim() || null : null;
  if (notes && notes.length > 4000) throw badRequest('notes must be at most 4,000 characters');
  const row = session(db, sessionId); if (row.status === 'completed') throw conflict('Completed standups are read-only'); if (input.awareDate > row.standup_date) throw badRequest('awareDate cannot be after the standup date');
  const context = getStandupIntakeContext(db, sessionId); if (!context?.requests.some((item) => item.key === jiraKey)) throw badRequest('Intake request is not in this standup snapshot');
  const record: IntakeAwarenessRecord = { id: `intake_awareness_${randomUUID()}`, jiraKey, standupSessionId: sessionId, awareDate: input.awareDate, dateConfidence: input.dateConfidence as IntakeAwarenessConfidence, notes, createdAt: new Date().toISOString() };
  try { db.prepare('INSERT INTO intake_request_awareness (id, jira_key, standup_session_id, aware_date, date_confidence, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(record.id, record.jiraKey, record.standupSessionId, record.awareDate, record.dateConfidence, record.notes, record.createdAt); } catch (error: any) { if (String(error?.message).includes('UNIQUE')) throw conflict('This intake request has already been logged'); throw error; }
  return record;
}
