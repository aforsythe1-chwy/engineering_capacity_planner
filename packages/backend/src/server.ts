import Fastify from 'fastify';
import { type AppConfig, loadConfig, loadDotenv } from './config.js';
import { openDatabase } from './db/database.js';
import { prepareRuntimeDatabase } from './db/test-database.js';
import { readDataset, writeDataset } from './db/persist.js';
import { buildJiraClient, createImporter } from './importer/factory.js';
import { HttpError } from './http-error.js';
import type { JiraClient } from './jira/client.js';
import { createDemoJiraClient, DEMO_MAPPING } from './jira/demo.js';
import { CachedJiraClient, JiraRequestCache } from './jira/request-cache.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerBandwidthRoutes } from './routes/bandwidth.js';
import { registerTeamSprintOutputRoutes } from './routes/team-sprint-output.js';
import { registerStandupRoutes } from './routes/standup.js';
import { registerDbRoutes } from './routes/db.js';
import { registerStandupAudioRoutes, UPLOAD_HEADERS } from './routes/standup-audio.js';
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
  const databaseTarget = await prepareRuntimeDatabase(config.dbPath, config.testDb);
  config = { ...config, dbPath: databaseTarget.effectivePath };
  let jiraCache: JiraRequestCache | undefined;

  if (databaseTarget.mode === 'test-copy') {
    app.log.info(
      `ECP_TEST_DB enabled — using ephemeral copy ${databaseTarget.effectivePath} of ${databaseTarget.sourcePath}; local changes will be discarded on restart`,
    );
  } else {
    app.log.info(`Persistent database mode — changes will be saved to ${databaseTarget.sourcePath}`);
  }

  try {

  // Demo mode: stand up a pre-seeded fake Jira and default its mapping, so the
  // field mapper + Sync work in the real app with no credentials.
  let jiraRawClient = deps.jiraClient;
  let jiraClient = jiraRawClient;
  const db = openDatabase({ path: config.dbPath });
  app.addHook('onClose', async () => {
    try {
      db.close();
    } finally {
      try {
        databaseTarget.cleanup();
        if (databaseTarget.mode === 'test-copy') {
          app.log.info(`Discarded ephemeral test database copy at ${databaseTarget.effectivePath}`);
        }
      } catch (error) {
        app.log.warn({ err: error, workspace: databaseTarget.effectivePath }, 'Unable to discard ephemeral test database copy');
      }
    }
  });
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
    reply.header('Access-Control-Allow-Headers', ['Content-Type', ...UPLOAD_HEADERS].join(', '));
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

  app.get('/health', async () => ({
    status: 'ok',
    dataSource: config.dataSource,
    jiraRequestDebug: jiraCache?.enabled ?? false,
    databaseMode: databaseTarget.mode,
  }));

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
  registerTeamSprintOutputRoutes(app, db, jiraClient, config);
  registerStandupRoutes(app, db, jiraClient, config);
  registerStandupAudioRoutes(app, db);
  // Gantt Planner placement endpoints (project plan §6a).
  registerPlanningRoutes(app, db);
  // Jira sync: re-import + reconcile (project plan §7).
  registerSyncRoutes(app, db, config, jiraRawClient, syncCoordinator);
  // Jira introspection for the live field mapper (project plan §7).
  registerJiraRoutes(app, db, config, jiraClient, jiraCache);
  // Local DB snapshot + drag-and-drop import.
  registerDbRoutes(app, db, config);

  return app;
  } catch (error) {
    try {
      await app.close();
    } finally {
      // Covers failures while opening the working copy, before its onClose hook
      // has been registered. The target cleanup is idempotent for later stages.
      try {
        databaseTarget.cleanup();
      } catch (cleanupError) {
        app.log.warn({ err: cleanupError, workspace: databaseTarget.effectivePath }, 'Unable to discard ephemeral test database copy');
      }
    }
    throw error;
  }
}

/** Install one-shot process shutdown handling for the executable server only. */
export function installGracefulShutdown(app: Awaited<ReturnType<typeof buildServer>>): void {
  let shuttingDown: Promise<void> | undefined;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = (async () => {
      app.log.info(`Received ${signal}; shutting down gracefully`);
      try {
        await app.close();
      } catch (error) {
        process.exitCode = 1;
        app.log.error(error, 'Graceful shutdown failed');
      }
    })();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

// Entry point: `npm start` after a build, or `npm run dev` via tsx.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadDotenv();
  const config = loadConfig();
  buildServer(config)
    .then(async (app) => {
      await app.listen({ port: config.port, host: config.host });
      installGracefulShutdown(app);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
    });
}
