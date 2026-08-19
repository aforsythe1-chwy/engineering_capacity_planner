import Fastify from 'fastify';
import { type AppConfig, loadConfig, loadDotenv } from './config.js';
import { openDatabase } from './db/database.js';
import { readDataset, writeDataset } from './db/persist.js';
import { buildJiraClient, createImporter } from './importer/factory.js';
import { HttpError } from './http-error.js';
import type { JiraClient } from './jira/client.js';
import { createDemoJiraClient, DEMO_MAPPING } from './jira/demo.js';
import { CachedJiraClient, JiraRequestCache } from './jira/request-cache.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerBandwidthRoutes } from './routes/bandwidth.js';
import { registerStandupRoutes } from './routes/standup.js';
import { registerDbRoutes } from './routes/db.js';
import { registerJiraRoutes } from './routes/jira.js';
import { registerPlanningRoutes } from './routes/planning.js';
import { registerPortfolioRoutes } from './routes/portfolio.js';
import { registerSyncRoutes } from './routes/sync.js';
import { SyncCoordinator } from './sync/sync-service.js';

/** Injectable dependencies (used by tests / the round-trip harness). */
export interface BuildServerDeps {
  /** Override the Jira client (e.g. the in-memory fake) instead of HTTP. */
  jiraClient?: JiraClient;
}

/**
 * Minimal localhost API serving the domain data to the frontend.
 *
 * All environment-specific behavior comes from {@link AppConfig}; pass a partial
 * override for tests. The database is the source of truth — if it's empty on
 * startup and `seedIfEmpty` is set, it's populated from the configured importer
 * (synthetic today, Jira in Phase 7), so `npm run dev` works with zero setup.
 */
export async function buildServer(overrides: Partial<AppConfig> = {}, deps: BuildServerDeps = {}) {
  let config: AppConfig = { ...loadConfig(), ...overrides };

  const app = Fastify({ logger: true });
  let jiraCache: JiraRequestCache | undefined;

  // Demo mode: stand up a pre-seeded fake Jira and default its mapping, so the
  // field mapper + Sync work in the real app with no credentials.
  let jiraRawClient = deps.jiraClient;
  let jiraClient = jiraRawClient;
  const db = openDatabase({ path: config.dbPath });
  if (config.jiraFake && !jiraRawClient) {
    jiraRawClient = await createDemoJiraClient(config.syntheticSeed);
    jiraClient = jiraRawClient;
    config = {
      ...config,
      dataSource: 'jira',
      jira: {
        ...config.jira,
        projectKey: config.jira.projectKey ?? DEMO_MAPPING.projectKey,
        storyPointsField: config.jira.storyPointsField ?? DEMO_MAPPING.storyPointsField,
        blocksLinkType: config.jira.blocksLinkType ?? DEMO_MAPPING.blocksLinkType,
      },
    };
    app.log.info('ECP_JIRA_FAKE — using an in-memory demo Jira board');
  }
  if (config.dataSource === 'jira' && !config.jiraFake) {
    jiraCache = new JiraRequestCache(config.jiraCacheTtlMs, config.jiraRequestDebug);
    jiraRawClient = jiraRawClient ?? buildJiraClient(config.jira);
    // Discovery may reuse a short-lived cache; full planner sync always gets
    // jiraRawClient and therefore performs fresh source reads.
    jiraClient = new CachedJiraClient(jiraRawClient, jiraCache);
  }

  const syncCoordinator = new SyncCoordinator(db, config, jiraRawClient);

  if (config.seedIfEmpty) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM epic').get() as { n: number };
    if (n === 0) {
      if (config.dataSource === 'jira') {
        try {
          await syncCoordinator.run('startup');
          app.log.info('Empty database — populated through the authoritative Jira sync service');
        } catch (error) {
          if (error instanceof HttpError && error.statusCode === 400) {
            app.log.warn('Empty database — Jira mapping is incomplete; waiting for explicit sync after setup');
          } else {
            throw error;
          }
        }
      } else {
        const importer = createImporter(config, [], jiraRawClient);
        app.log.info(`Empty database — importing synthetic fixture from "${importer.name}" source`);
        writeDataset(db, await importer.fetch());
      }
    }
  }

  // CORS origin is configurable; `*` by default for local dev. The
  // Configuration tab writes, so the mutating verbs are allowed too.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') reply.send();
  });

  // Translate typed HttpErrors into their status codes; everything else 500s.
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  app.get('/health', async () => ({ status: 'ok', dataSource: config.dataSource, jiraRequestDebug: jiraCache?.enabled ?? false }));

  app.get('/api/summary', async () => {
    const data = readDataset(db);
    return {
      teams: data.teams.length,
      members: data.members.length,
      epics: data.epics.map((e) => e.key),
      stories: data.stories.length,
      workItems: data.workItems.length,
      dependencies: data.dependencies.length,
      totalPoints: data.workItems.reduce((sum, w) => sum + w.points, 0),
    };
  });

  app.get('/api/dataset', async () => readDataset(db));
  registerPortfolioRoutes(app, db);

  // Mutating Configuration-tab endpoints (project plan §6).
  registerConfigRoutes(app, db);
  registerBandwidthRoutes(app, db);
  registerStandupRoutes(app, db, jiraClient, config);
  // Gantt Planner placement endpoints (project plan §6a).
  registerPlanningRoutes(app, db);
  // Jira sync: re-import + reconcile (project plan §7).
  registerSyncRoutes(app, db, config, jiraRawClient, syncCoordinator);
  // Jira introspection for the live field mapper (project plan §7).
  registerJiraRoutes(app, db, config, jiraClient, jiraCache);
  // Local DB snapshot + drag-and-drop import.
  registerDbRoutes(app, db, config);

  app.addHook('onClose', async () => {
    db.close();
  });

  return app;
}

// Entry point: `npm start` after a build, or `npm run dev` via tsx.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadDotenv();
  const config = loadConfig();
  buildServer()
    .then((app) => app.listen({ port: config.port, host: config.host }))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
