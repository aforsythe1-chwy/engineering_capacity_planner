import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { readDataset } from '../db/persist.js';
import { HttpError } from '../http-error.js';
import type { JiraClient } from '../jira/client.js';
import { getTeamSprintOutput } from '../jira/team-sprint-output.js';

export function registerTeamSprintOutputRoutes(app: FastifyInstance, db: Db, jiraClient: JiraClient | undefined, config: AppConfig): void {
  const pending = new Map<string, Promise<unknown>>();
  app.get<{ Params: { teamId: string } }>('/api/teams/:teamId/current-sprint-output', async (req) => {
    const current = pending.get(req.params.teamId) ?? getTeamSprintOutput(jiraClient, readDataset(db), req.params.teamId, config.jira.baseUrl).catch((error) => { if ((error as { statusCode?: number }).statusCode === 404) throw new HttpError(404, 'Team not found.'); throw error; });
    pending.set(req.params.teamId, current);
    try { return await current; } finally { pending.delete(req.params.teamId); }
  });
}
