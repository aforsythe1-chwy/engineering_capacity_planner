import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as standup from '../db/standup.js';
import * as intake from '../db/intake.js';
import { refreshStandupMemberTickets } from '../jira/standup-context.js';
import { refreshStandupIntakeRequests } from '../jira/intake-context.js';
import type { JiraClient } from '../jira/client.js';
import type { AppConfig } from '../config.js';

export function registerStandupRoutes(app: FastifyInstance, db: Db, jiraClient?: JiraClient, config?: Pick<AppConfig, 'standupTicketRefreshTimeoutMs' | 'jira'>): void {
  const intakeRefreshes = new Map<string, Promise<import('@ecp/shared').StandupIntakeContext>>();
  const refreshIntake = (sessionId: string) => {
    intake.assertIntakeMutable(db, sessionId);
    const existing = intakeRefreshes.get(sessionId); if (existing) return existing;
    const task = (async () => {
      const previous = intake.getStandupIntakeContext(db, sessionId);
      const context = await refreshStandupIntakeRequests(jiraClient, config?.jira.baseUrl ?? null, config?.standupTicketRefreshTimeoutMs);
      if (context.freshness === 'unavailable' && previous && previous.freshness !== 'unavailable') {
        const stale = { ...previous, freshness: 'stale' as const, errorMessage: context.errorMessage };
        intake.saveStandupIntakeContext(db, sessionId, stale); return stale;
      }
      intake.saveStandupIntakeContext(db, sessionId, context); return context;
    })();
    intakeRefreshes.set(sessionId, task); void task.finally(() => intakeRefreshes.delete(sessionId)); return task;
  };
  app.post('/api/standups/start', async (req) => standup.startStandup(db, (req.body ?? {}) as never));
  app.get<{ Querystring: { teamId: string } }>('/api/standups', async (req) => ({ sessions: standup.listStandups(db, req.query.teamId) }));
  app.get<{ Params: { sessionId: string } }>('/api/standups/:sessionId', async (req) => standup.getStandup(db, req.params.sessionId));
  app.get<{ Params: { sessionId: string } }>('/api/standups/:sessionId/intake-requests', async (req) => intake.getStandupIntakeContext(db, req.params.sessionId));
  app.post<{ Params: { sessionId: string } }>('/api/standups/:sessionId/intake-requests/refresh', async (req) => refreshIntake(req.params.sessionId));
  app.post<{ Params: { sessionId: string; jiraKey: string } }>('/api/standups/:sessionId/intake-requests/:jiraKey/awareness', async (req) => intake.createIntakeAwareness(db, req.params.sessionId, req.params.jiraKey, req.body));
  app.get<{ Params: { sessionId: string; memberId: string } }>('/api/standups/:sessionId/participants/:memberId/tickets', async (req) => standup.getMemberTicketContext(db, req.params.sessionId, req.params.memberId));
  app.post<{ Params: { sessionId: string; memberId: string } }>('/api/standups/:sessionId/participants/:memberId/tickets/refresh', async (req) => {
    const previous = standup.getMemberTicketContext(db, req.params.sessionId, req.params.memberId);
    const context = await refreshStandupMemberTickets(jiraClient, { memberId: req.params.memberId, ...standup.standupMemberJiraContext(db, req.params.sessionId, req.params.memberId), jiraBaseUrl: config?.jira.baseUrl }, config?.standupTicketRefreshTimeoutMs);
    if (context.freshness === 'unavailable' && previous && previous.freshness !== 'unavailable') {
      return { ...previous, freshness: 'stale' as const, errorMessage: context.errorMessage };
    }
    standup.saveMemberTicketContext(db, req.params.sessionId, context);
    return context;
  });
  app.put<{ Params: { sessionId: string; memberId: string } }>('/api/standups/:sessionId/participants/:memberId', async (req) => standup.resolveParticipant(db, req.params.sessionId, req.params.memberId, (req.body ?? {}) as never));
  app.put<{ Params: { sessionId: string; memberId: string } }>('/api/standups/:sessionId/check-ins/:memberId', async (req) => standup.upsertCheckIn(db, req.params.sessionId, req.params.memberId, req.body));
  app.delete<{ Params: { sessionId: string; memberId: string } }>('/api/standups/:sessionId/check-ins/:memberId', async (req, reply) => { standup.deleteCheckIn(db, req.params.sessionId, req.params.memberId); reply.code(204); });
  app.post<{ Params: { sessionId: string } }>('/api/standups/:sessionId/notes', async (req) => standup.createNote(db, req.params.sessionId, req.body));
  app.put<{ Params: { sessionId: string; noteId: string } }>('/api/standups/:sessionId/notes/:noteId', async (req) => standup.updateNote(db, req.params.sessionId, req.params.noteId, req.body));
  app.delete<{ Params: { sessionId: string; noteId: string } }>('/api/standups/:sessionId/notes/:noteId', async (req) => standup.deleteNote(db, req.params.sessionId, req.params.noteId, req.body));
  app.patch<{ Params: { sessionId: string; noteId: string } }>('/api/standups/:sessionId/notes/:noteId/state', async (req) => standup.setNoteState(db, req.params.sessionId, req.params.noteId, req.body));
  app.put<{ Params: { sessionId: string } }>('/api/standups/:sessionId/notes/order', async (req) => standup.reorderNotes(db, req.params.sessionId, req.body));
  app.post<{ Params: { sessionId: string } }>('/api/standups/:sessionId/finish', async (req) => standup.finishStandup(db, req.params.sessionId, req.body));
  app.delete<{ Params: { sessionId: string } }>('/api/standups/:sessionId', async (req, reply) => { standup.deleteStandup(db, req.params.sessionId); reply.code(204); });
}
