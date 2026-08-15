import { projectPortfolioFromDataset } from '@ecp/engine';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import { readDataset } from '../db/persist.js';
import { effectivePortfolioEpic } from '@ecp/shared';
import { replaceEpicSmes, updatePortfolioEpic } from '../db/repository.js';
import { HttpError } from '../http-error.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Portfolio-shaped reads and the small local-intent write surface. */
export function registerPortfolioRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/portfolio', async () => {
    const dataset = readDataset(db); const projection = projectPortfolioFromDataset(dataset, today());
    return { epics: dataset.epics.filter((e) => e.active !== false).map((epic) => ({ ...epic, ...effectivePortfolioEpic(dataset, epic.key), projection: projection.epics.find((p) => p.epicKey === epic.key) })), archivedEpics: dataset.epics.filter((e) => e.active === false), projection };
  });
  app.get('/api/portfolio/load', async () => projectPortfolioFromDataset(readDataset(db), today()));
  app.get<{ Params: { key: string } }>('/api/epics/:key', async (req) => {
    const dataset = readDataset(db); const epic = dataset.epics.find((e) => e.key === req.params.key);
    if (!epic) throw new HttpError(404, `Epic ${req.params.key} not found`);
    const storyKeys = new Set(dataset.stories.filter((s) => s.epicKey === epic.key).map((s) => s.key));
    return { epic, milestones: dataset.milestones.filter((m) => m.epicKey === epic.key), stories: dataset.stories.filter((s) => s.epicKey === epic.key), workItems: dataset.workItems.filter((w) => storyKeys.has(w.storyKey)) };
  });
  app.put<{ Params: { key: string }; Body: { scopeOverride?: string; planningKind?: string; priority?: number } }>('/api/portfolio/epics/:key', async (req) =>
    updatePortfolioEpic(db, req.params.key, req.body ?? {}),
  );
  app.put<{ Params: { key: string }; Body: { memberIds?: unknown; [key: string]: unknown } }>('/api/portfolio/epics/:key/smes', async (req) =>
    replaceEpicSmes(db, req.params.key, req.body ?? {}),
  );
}
