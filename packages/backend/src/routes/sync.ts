import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { readSyncLog } from '../db/sync-log.js';
import type { JiraClient } from '../jira/client.js';
import { SyncCoordinator } from '../sync/sync-service.js';

/** Thin HTTP adapter; all planner-fact sync policy lives in SyncCoordinator. */
export function registerSyncRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  jiraClient?: JiraClient,
  coordinator = new SyncCoordinator(db, config, jiraClient),
): SyncCoordinator {
  app.post('/api/sync', async () => coordinator.run('manual'));
  app.get('/api/sync/log', async () => ({ entries: readSyncLog(db) }));
  return coordinator;
}
