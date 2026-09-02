import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as ceremonies from '../db/sprint-ceremony.js';
import type { JiraClient } from '../jira/client.js';
import { conflict } from '../http-error.js';

export function registerSprintCeremonyRoutes(app: FastifyInstance, db: Db, jiraClient?: JiraClient, jiraBaseUrl?: string | null, requireJira = false): void {
  const refreshes = new Map<string, Promise<Awaited<ReturnType<typeof ceremonies.refreshCeremonyContext>>>>();
  const refresh = (ceremonyId: string) => { const existing = refreshes.get(ceremonyId); if (existing) return existing; const task = ceremonies.refreshCeremonyContext(db, ceremonyId, jiraClient, jiraBaseUrl); refreshes.set(ceremonyId, task); void task.finally(() => refreshes.delete(ceremonyId)); return task; };
  app.get<{ Params: { teamId: string }; Querystring: { kind?: ceremonies.CeremonyKind } }>('/api/teams/:teamId/sprint-ceremonies', async (req) => ({ ceremonies: ceremonies.listCeremonies(db, req.params.teamId, req.query.kind) }));
  app.post('/api/sprint-ceremonies/open', async (req) => ceremonies.openCeremony(db, (req.body ?? {}) as never));
  app.get<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId', async (req) => ceremonies.getCeremony(db, req.params.ceremonyId));
  app.post<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId/refresh', async (req) => refresh(req.params.ceremonyId));
  app.put<{ Params: { ceremonyId: string; workItemKey: string } }>('/api/sprint-ceremonies/:ceremonyId/plan-items/:workItemKey', async (req) => ceremonies.setPlanItem(db, req.params.ceremonyId, req.params.workItemKey, (req.body ?? {}) as never));
  app.delete<{ Params: { ceremonyId: string; workItemKey: string } }>('/api/sprint-ceremonies/:ceremonyId/plan-items/:workItemKey', async (req) => ceremonies.removePlanItem(db, req.params.ceremonyId, req.params.workItemKey, (req.body ?? {}) as never));
  app.put<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId/plan-items/order', async (req) => ceremonies.reorderPlanItems(db, req.params.ceremonyId, (req.body ?? {}) as never));
  app.post<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId/notes', async (req) => ceremonies.addNote(db, req.params.ceremonyId, req.body));
  app.put<{ Params: { ceremonyId: string; noteId: string } }>('/api/sprint-ceremonies/:ceremonyId/notes/:noteId', async (req) => ceremonies.updateNote(db, req.params.ceremonyId, req.params.noteId, req.body));
  app.delete<{ Params: { ceremonyId: string; noteId: string } }>('/api/sprint-ceremonies/:ceremonyId/notes/:noteId', async (req) => ceremonies.deleteNote(db, req.params.ceremonyId, req.params.noteId, req.body));
  app.put<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId/notes/order', async (req) => ceremonies.reorderNotes(db, req.params.ceremonyId, (req.body ?? {}) as never));
  app.post<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId/finalize', async (req) => { const refreshed = await refresh(req.params.ceremonyId); const body = (req.body ?? {}) as { payload?: { acknowledgeActiveSprint?: unknown } }; const state = db.prepare('SELECT state FROM sprint WHERE id = ? AND team_id = ?').get(refreshed.ceremony.sprintId, refreshed.ceremony.teamId) as { state?: string | null } | undefined; if (refreshed.ceremony.kind === 'review' && state?.state === 'active' && body.payload?.acknowledgeActiveSprint !== true) throw conflict('Confirm that this is an early active-sprint review before completing it.'); if (refreshed.context.freshness !== 'fresh' || refreshed.context.truncated || (requireJira && refreshed.context.source !== 'jira')) throw conflict(refreshed.context.truncated ? 'Jira returned a truncated sprint result; refresh after reducing source scope.' : requireJira ? 'A fresh Jira sprint result is required before finalizing.' : 'A complete current sprint result is required before finalizing.'); return ceremonies.finalizeCeremony(db, req.params.ceremonyId, body as never, refreshed.context); });
  app.post<{ Params: { ceremonyId: string } }>('/api/sprint-ceremonies/:ceremonyId/reopen', async (req) => ceremonies.reopenPlanningCeremony(db, req.params.ceremonyId, (req.body ?? {}) as never));
}
