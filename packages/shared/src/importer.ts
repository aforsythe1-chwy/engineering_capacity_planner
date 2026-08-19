import type { DomainDataset } from './domain.js';

/** The completeness boundary used by a planner-fact synchronization. */
export interface SyncScope {
  kind: 'complete-board' | 'complete-single-epic' | 'complete-dataset';
  projectKey: string | null;
  boardId: string | null;
  observedEpicKeys: string[];
  activeEpicKeys: string[];
  complete: true;
}

/** A complete source result suitable for reconciling missing Jira facts. */
export interface SyncSnapshot {
  dataset: DomainDataset;
  source: 'jira' | 'synthetic';
  scope: SyncScope;
}

/**
 * The single contract every data source implements (project plan §7).
 *
 * The {@link SyntheticImporter} implements it today; a `JiraImporter` will
 * implement the same interface later using the field-mapping settings, with
 * zero changes required in the engine, timeline, or graph.
 *
 * `fetch()` is async so real network-backed importers (Jira) fit the same
 * shape; the synthetic importer simply resolves immediately.
 */
export interface Importer {
  /** Stable identifier for the source, e.g. `"synthetic"` or `"jira"`. */
  readonly name: string;
  /** Produce a complete, self-consistent {@link DomainDataset}. */
  fetch(): Promise<DomainDataset>;
  /**
   * Full-sync contract. Older and synthetic importers can expose only fetch;
   * the coordinator converts those complete datasets into a complete snapshot.
   */
  fetchSyncSnapshot?(): Promise<SyncSnapshot>;
}
