import type { DomainDataset, Sprint } from '@ecp/shared';
import { projectPortfolioFromDataset } from './portfolio.js';

export interface SprintPlanningOutlookRow {
  epicKey: string;
  requiredPoints: number;
  selectedPoints: number;
  gapPoints: number;
  health: string;
  reason: string;
  gatingDate: string | null;
  bufferWorkingDays: number | null;
  unestimatedItems: number;
}

/**
 * Presents the existing shared portfolio allocation as a sprint-sized outlook.
 * No row receives an independent capacity pool: required points are the amount
 * the single allocator scheduled for that epic during this sprint window.
 */
export function buildSprintPlanningOutlook(dataset: DomainDataset, sprint: Sprint, selectedItemKeys: readonly string[] = []): SprintPlanningOutlookRow[] {
  const projection = projectPortfolioFromDataset(dataset, sprint.startDate);
  const selected = new Set(selectedItemKeys);
  const storyEpic = new Map(dataset.stories.map((story) => [story.key, story.epicKey]));
  const selectedByEpic = new Map<string, number>();
  for (const item of dataset.workItems) if (selected.has(item.key)) { const epic = storyEpic.get(item.storyKey) ?? 'Unattributed'; selectedByEpic.set(epic, (selectedByEpic.get(epic) ?? 0) + (item.isEstimated === false ? 0 : item.points)); }
  return projection.epics.filter((epic) => dataset.epics.find((entry) => entry.key === epic.epicKey)?.teamId === sprint.teamId).map((epic) => {
    const requiredPoints = projection.weeks.filter((week) => week.end >= sprint.startDate && week.start <= sprint.endDate).flatMap((week) => week.contributions).filter((contribution) => contribution.epicKey === epic.epicKey).reduce((sum, contribution) => sum + contribution.load, 0);
    const selectedPoints = selectedByEpic.get(epic.epicKey) ?? 0;
    return { epicKey: epic.epicKey, requiredPoints: Math.round(requiredPoints * 100) / 100, selectedPoints, gapPoints: Math.round((selectedPoints - requiredPoints) * 100) / 100, health: epic.health, reason: epic.reason, gatingDate: dataset.milestones.find((milestone) => milestone.epicKey === epic.epicKey && milestone.isGating)?.date ?? null, bufferWorkingDays: epic.bufferWorkingDays, unestimatedItems: epic.unestimatedItems };
  }).sort((a, b) => a.epicKey.localeCompare(b.epicKey));
}
