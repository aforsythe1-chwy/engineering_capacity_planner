import Fastify from 'fastify';
import { type AppConfig, loadConfig, loadDotenv } from './config.js';
import { openDatabase } from './db/database.js';
import { readDataset, writeDataset } from './db/persist.js';
import { createImporter } from './importer/factory.js';
import { HttpError } from './http-error.js';
import type { JiraClient } from './jira/client.js';
import { createDemoJiraClient, DEMO_MAPPING } from './jira/demo.js';
import { loadJiraStore } from './jira/store/load.js';
import { ReplayJiraClient } from './jira/store/replay-client.js';
import type { OfflineJiraStoreV1 } from './jira/store/schema.js';
import { SETTING_KEYS } from '@ecp/shared';
import { registerConfigRoutes } from './routes/config.js';
import { registerDbRoutes } from './routes/db.js';
import { registerJiraRoutes } from './routes/jira.js';
import { registerPlanningRoutes } from './routes/planning.js';
import { registerSyncRoutes } from './routes/sync.js';

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
  let store: OfflineJiraStoreV1 | undefined;

  // Demo mode: stand up a pre-seeded fake Jira and default its mapping, so the
  // field mapper + Sync work in the real app with no credentials.
  let jiraClient = deps.jiraClient;
  if (config.dataSource === 'jira-store') {
    if (!config.jiraStorePath || (!config.jiraStorePasswordFile && !config.jiraStorePasswordOpRef)) {
      throw new Error('Offline Jira replay requires ECP_JIRA_STORE_PATH and a password file or 1Password secret reference.');
    }
    store = await loadJiraStore(config.jiraStorePath, {
      passwordFile: config.jiraStorePasswordFile,
      opRef: config.jiraStorePasswordOpRef,
    });
    jiraClient = new ReplayJiraClient(store);
    config = {
      ...config,
      jira: {
        ...config.jira,
        projectKey: store.mapping.projectKey,
        storyPointsField: store.mapping.storyPointsField,
        blocksLinkType: store.mapping.blocksLinkType,
      },
    };
    app.log.info('Offline Jira replay loaded and authenticated');
  }
  const db = openDatabase({ path: config.dbPath });
  if (store) {
    const current = db.prepare("SELECT value FROM settings WHERE key = ? AND scope = 'global' AND scope_id = ''")
      .get(SETTING_KEYS.JIRA_STORE_ID) as { value: string } | undefined;
    const existing = current ? JSON.parse(current.value) : null;
    if (existing && existing !== store.storeId) {
      throw new Error('This SQLite database belongs to a different encrypted Jira store. Use a new ECP_DB_PATH or run jira-store:reset-db.');
    }
    if (!existing) {
      const count = db.prepare('SELECT COUNT(*) AS n FROM epic').get() as { n: number };
      if (count.n > 0) throw new Error('This SQLite database is not associated with an encrypted Jira store. Use a new ECP_DB_PATH or run jira-store:reset-db.');
    }
  }
  if (config.jiraFake && !jiraClient) {
    jiraClient = await createDemoJiraClient(config.syntheticSeed);
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

  if (config.seedIfEmpty) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM epic').get() as { n: number };
    if (n === 0) {
      if (store) {
        writeDataset(db, store.ecpSeed.dataset);
        for (const [key, value] of [[SETTING_KEYS.JIRA_STORE_ID, store.storeId], [SETTING_KEYS.JIRA_STORE_SCHEMA_VERSION, store.schemaVersion]]) {
          db.prepare("INSERT INTO settings (key, scope, scope_id, value) VALUES (?, 'global', '', ?) ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value")
            .run(key, JSON.stringify(value));
        }
        app.log.info('Empty database — seeded from encrypted Jira replay');
      } else {
        const importer = createImporter(config, [], jiraClient);
        app.log.info(`Empty database — importing from "${importer.name}" source`);
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

  app.get('/health', async () => ({ status: 'ok', dataSource: config.dataSource, ...(store ? { offline: true } : {}) }));

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

  // Mutating Configuration-tab endpoints (project plan §6).
  registerConfigRoutes(app, db);
  // Gantt Planner placement endpoints (project plan §6a).
  registerPlanningRoutes(app, db);
  // Jira sync: re-import + reconcile (project plan §7).
  registerSyncRoutes(app, db, config, jiraClient);
  // Jira introspection for the live field mapper (project plan §7).
  registerJiraRoutes(app, db, config, jiraClient);
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
