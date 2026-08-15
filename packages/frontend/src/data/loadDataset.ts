import type { DomainDataset } from '@ecp/shared';
import fixture from '../fixtures/dataset.json';

/** Where the dataset came from, surfaced in the UI so the wiring is visible. */
export type DatasetSource = 'api' | 'bundled';
export type RuntimeDataSource = 'synthetic' | 'jira' | 'unknown';

export interface LoadedDataset {
  dataset: DomainDataset;
  source: DatasetSource;
  /** Importer selected by the connected backend, when it can be identified. */
  dataSource: RuntimeDataSource;
  /** Whether the backend has opted in to local Jira request diagnostics. */
  jiraRequestDebug: boolean;
}

/** The API path the UI fetches. In dev, Vite proxies `/api` to the backend. */
const DATASET_URL = `${import.meta.env.VITE_API_BASE ?? ''}/api/dataset`;
const HEALTH_URL = `${import.meta.env.VITE_API_BASE ?? ''}/health`;

/** The bundled synthetic fixture — used as an offline fallback and in tests. */
export function loadBundledDataset(): DomainDataset {
  return fixture as DomainDataset;
}

function looksLikeDataset(value: unknown): value is DomainDataset {
  const data = value as Partial<Record<keyof DomainDataset, unknown>>;
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(data.teams) &&
    Array.isArray(data.members) &&
    Array.isArray(data.velocityOverrides) &&
    Array.isArray(data.pto) &&
    Array.isArray(data.oncall) &&
    Array.isArray(data.epics) &&
    Array.isArray(data.milestones) &&
    Array.isArray(data.stories) &&
    Array.isArray(data.workItems) &&
    Array.isArray(data.dependencies) &&
    Array.isArray(data.sprints) &&
    Array.isArray(data.placements) &&
    Array.isArray(data.settings)
  );
}

/**
 * Load the dataset the UI operates on: prefer the live backend API, and fall
 * back to the bundled synthetic fixture when the API isn't reachable (so the
 * app still runs — and e2e still passes — with no backend).
 */
export async function loadDataset(): Promise<LoadedDataset> {
  try {
    const res = await fetch(DATASET_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data: unknown = await res.json();
      if (looksLikeDataset(data)) {
        let dataSource: RuntimeDataSource = 'unknown';
        let jiraRequestDebug = false;
        try {
          const health = await fetch(HEALTH_URL, { headers: { Accept: 'application/json' } });
          if (health.ok) {
            const healthData = (await health.json()) as { dataSource?: unknown; jiraRequestDebug?: unknown };
            if (healthData.dataSource === 'synthetic' || healthData.dataSource === 'jira') {
              dataSource = healthData.dataSource;
            }
            jiraRequestDebug = healthData.jiraRequestDebug === true;
          }
        } catch {
          // The dataset is still usable if the optional mode check fails.
        }
        return { dataset: data, source: 'api', dataSource, jiraRequestDebug };
      }
    }
  } catch {
    // Backend not running / unreachable — fall through to the bundled sample.
  }
  return { dataset: loadBundledDataset(), source: 'bundled', dataSource: 'synthetic', jiraRequestDebug: false };
}
