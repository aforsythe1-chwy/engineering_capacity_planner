import type { DomainDataset, EpicEstimate } from '@ecp/shared';

export type EstimateReviewChangeKind = 'new-item' | 'newly-estimated' | 'points-increased';

export interface EstimateReviewChange {
  key: string;
  kind: EstimateReviewChangeKind;
  previousPoints: number | null;
  currentPoints: number | null;
}

export interface EpicWorkload {
  epicKey: string;
  jiraEstimatedRemainingPoints: number;
  unrefinedRemainingPoints: number;
  modeledRemainingPoints: number;
  unestimatedJiraItems: number;
  hasUnrefinedEstimate: boolean;
  estimateReviewRequired: boolean;
  estimateReviewChanges: EstimateReviewChange[];
  factSignature: string;
  reviewedAt: string | null;
}

/** Canonical current Jira facts for not-Done work in one epic. */
export function remainingFactBasis(dataset: DomainDataset, epicKey: string): Record<string, number | null> {
  const storyKeys = new Set(dataset.stories.filter((story) => story.epicKey === epicKey).map((story) => story.key));
  const facts = dataset.workItems
    .filter((item) => storyKeys.has(item.storyKey) && item.status !== 'Done')
    .map((item) => [item.key, item.isEstimated === false ? null : item.points] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(facts);
}

/** Stable, JSON-safe optimistic-concurrency signature for a Jira fact basis. */
export function factSignature(basis: Record<string, number | null>): string {
  return JSON.stringify(Object.entries(basis).sort(([a], [b]) => a.localeCompare(b)));
}

export function estimateReviewChanges(
  reviewedBasis: Record<string, number | null>,
  currentBasis: Record<string, number | null>,
): EstimateReviewChange[] {
  const changes: EstimateReviewChange[] = [];
  for (const key of Object.keys(currentBasis).sort()) {
    const current = currentBasis[key]!;
    if (!(key in reviewedBasis)) {
      changes.push({ key, kind: 'new-item', previousPoints: null, currentPoints: current });
      continue;
    }
    const previous = reviewedBasis[key]!;
    if (previous === null && current !== null) {
      changes.push({ key, kind: 'newly-estimated', previousPoints: previous, currentPoints: current });
    } else if (previous !== null && current !== null && current > previous) {
      changes.push({ key, kind: 'points-increased', previousPoints: previous, currentPoints: current });
    }
  }
  return changes;
}

export function epicEstimate(dataset: Pick<DomainDataset, 'epicEstimates'>, epicKey: string): EpicEstimate | undefined {
  return dataset.epicEstimates?.find((estimate) => estimate.epicKey === epicKey);
}

/** The one authoritative hard-Jira plus soft-local workload calculation. */
export function resolveEpicWorkload(dataset: DomainDataset, epicKey: string): EpicWorkload {
  const basis = remainingFactBasis(dataset, epicKey);
  const estimate = epicEstimate(dataset, epicKey);
  const values = Object.values(basis);
  const jiraEstimatedRemainingPoints = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const unestimatedJiraItems = values.filter((value) => value === null).length;
  const unrefinedRemainingPoints = estimate?.unrefinedPoints ?? 0;
  const reviewChanges = estimate ? estimateReviewChanges(estimate.reviewedFactBasis, basis) : [];
  return {
    epicKey,
    jiraEstimatedRemainingPoints,
    unrefinedRemainingPoints,
    modeledRemainingPoints: jiraEstimatedRemainingPoints + unrefinedRemainingPoints,
    unestimatedJiraItems,
    hasUnrefinedEstimate: Boolean(estimate),
    estimateReviewRequired: reviewChanges.length > 0,
    estimateReviewChanges: reviewChanges,
    factSignature: factSignature(basis),
    reviewedAt: estimate?.reviewedAt ?? null,
  };
}
