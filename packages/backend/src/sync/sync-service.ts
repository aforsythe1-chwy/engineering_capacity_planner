import { randomUUID } from 'node:crypto';
import { effectivePortfolioEpic, type DomainDataset, type Setting, type SyncSnapshot } from '@ecp/shared';
import { resolveEpicWorkload } from '@ecp/engine';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { readDataset, replaceDatasetRows } from '../db/persist.js';
import { reconcileDataset, type ReconcileSummary } from '../db/reconcile.js';
import { appendSyncLog } from '../db/sync-log.js';
import { HttpError } from '../http-error.js';
import { createImporter } from '../importer/factory.js';
import type { JiraClient } from '../jira/client.js';
import { MappingError } from '../jira/mapping.js';

export interface SyncOutcome {
  runId: string;
  source: string;
  syncedAt: string;
  coalesced: boolean;
  summary: ReconcileSummary;
  changes: ReturnType<typeof reconcileDataset>['changes'];
  estimateReviews: Array<{ epicKey: string; workload: ReturnType<typeof resolveEpicWorkload> }>;
  warnings: string[];
}

type Trigger = 'manual' | 'startup';

function mappingFingerprint(settings: Setting[]): string {
  return JSON.stringify(settings
    .filter((setting) => setting.scope === 'global' && setting.key.startsWith('jira_'))
    .map((setting) => [setting.key, setting.value] as const)
    .sort(([a], [b]) => a.localeCompare(b)));
}

function completeDatasetSnapshot(dataset: DomainDataset, source: 'jira' | 'synthetic'): SyncSnapshot {
  return {
    dataset,
    source,
    scope: {
      kind: 'complete-dataset', projectKey: null, boardId: null,
      observedEpicKeys: dataset.epics.map((epic) => epic.key),
      activeEpicKeys: dataset.epics.filter((epic) => epic.active !== false).map((epic) => epic.key),
      complete: true,
    },
  };
}

function recordSyncTime(db: Db, iso: string): void {
  db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value) VALUES ('last_synced_at', 'global', '', ?)
     ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(iso));
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new HttpError(504, `Sync timed out after ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One process-local owner for the full planner-fact synchronization lifecycle. */
export class SyncCoordinator {
  private inFlight: Promise<Omit<SyncOutcome, 'coalesced'>> | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly jiraClient?: JiraClient,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async run(trigger: Trigger = 'manual'): Promise<SyncOutcome> {
    if (this.inFlight) {
      const outcome = await this.inFlight;
      return { ...outcome, coalesced: true };
    }
    const task = this.execute(trigger);
    this.inFlight = task;
    try {
      return { ...(await task), coalesced: false };
    } finally {
      if (this.inFlight === task) this.inFlight = null;
    }
  }

  private async execute(trigger: Trigger): Promise<Omit<SyncOutcome, 'coalesced'>> {
    const initial = readDataset(this.db);
    const initialFingerprint = mappingFingerprint(initial.settings);
    let importer;
    try {
      importer = createImporter(this.config, initial.settings, this.jiraClient);
    } catch (error) {
      if (error instanceof MappingError) throw new HttpError(400, error.message);
      throw error;
    }
    let snapshot: SyncSnapshot;
    try {
      snapshot = await withTimeout(
        importer.fetchSyncSnapshot?.() ?? importer.fetch().then((dataset) => completeDatasetSnapshot(dataset, importer.name === 'jira' ? 'jira' : 'synthetic')),
        this.config.fullSyncTimeoutMs,
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof MappingError || /incomplete/i.test(message)) throw new HttpError(400, message);
      throw new HttpError(502, `Sync failed: ${message}`);
    }
    if (snapshot.scope.complete !== true) throw new HttpError(502, 'Sync did not return a complete source snapshot');

    // Jira fetches occur outside a database transaction. Re-read intent only
    // after the network phase so a concurrent local edit is never overwritten.
    const latest = readDataset(this.db);
    if (mappingFingerprint(latest.settings) !== initialFingerprint) {
      throw new HttpError(409, 'Jira configuration changed while sync was running; sync again');
    }
    const syncedAt = this.clock();
    const { merged, summary, changes } = reconcileDataset(latest, snapshot.dataset, syncedAt);
    this.db.transaction(() => {
      replaceDatasetRows(this.db, merged);
      recordSyncTime(this.db, syncedAt);
      appendSyncLog(this.db, { syncedAt, source: snapshot.source, summary: summary as unknown as Record<string, number>, changes });
    })();

    const warnings: string[] = [];
    try {
      const cacheWriter = importer as typeof importer & { persistLastCache?: () => void };
      cacheWriter.persistLastCache?.();
    } catch {
      warnings.push('Planner sync succeeded, but the local raw Jira cache could not be updated.');
    }
    const estimateReviews = merged.epics
      .filter((epic) => effectivePortfolioEpic(merged, epic.key).tracked)
      .map((epic) => ({ epicKey: epic.key, workload: resolveEpicWorkload(merged, epic.key) }))
      .filter(({ workload }) => workload.estimateReviewRequired);
    return { runId: `sync_${randomUUID().slice(0, 8)}`, source: snapshot.source, syncedAt, summary, changes, estimateReviews, warnings };
  }
}
