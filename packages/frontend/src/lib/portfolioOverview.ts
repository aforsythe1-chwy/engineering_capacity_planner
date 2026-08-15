import type { PortfolioProjection, PortfolioHealth } from '@ecp/engine';
import { effectivePortfolioEpic, type DomainDataset, type IsoDate } from '@ecp/shared';
import type { EpicPickerOption } from './epicPicker';

const healthOrder: Record<PortfolioHealth, number> = { red: 0, yellow: 1, 'needs-target': 2, 'needs-estimates': 2, 'needs-plan': 2, ongoing: 3, green: 4 };

export interface PortfolioOverviewModel {
  activeEpicCount: number;
  remainingPoints: number;
  unestimatedItems: number;
  peakUtilization: number;
  overloadedWeekCount: number;
  rows: Array<PortfolioProjection['epics'][number] & { title: string; targetDate: IsoDate | null; targetName: string | null; teamName: string; assigneeNames: string[] }>;
  weeks: PortfolioProjection['weeks'];
  pickerOptions: EpicPickerOption[];
}

export function buildPortfolioOverview(dataset: DomainDataset, projection: PortfolioProjection): PortfolioOverviewModel {
  const activeEpics = dataset.epics.filter((epic) => effectivePortfolioEpic(dataset, epic.key).tracked);
  const resultByKey = new Map(projection.epics.map((result) => [result.epicKey, result]));
  const rows = activeEpics.flatMap((epic) => {
    const result = resultByKey.get(epic.key);
    if (!result) return [];
    const milestone = dataset.milestones.find((item) => item.epicKey === epic.key && item.isGating) ?? null;
    const storyKeys = new Set(dataset.stories.filter((story) => story.epicKey === epic.key).map((story) => story.key));
    const assigneeNames = [...new Set(dataset.workItems.filter((item) => storyKeys.has(item.storyKey) && item.status !== 'Done' && item.assigneeId).map((item) => dataset.members.find((member) => member.id === item.assigneeId)?.name).filter((name): name is string => Boolean(name)))];
    return [{ ...result, title: epic.title, targetDate: milestone?.date ?? null, targetName: milestone?.name ?? null, teamName: dataset.teams.find((team) => team.id === epic.teamId)?.name ?? 'Unassigned team', assigneeNames }];
  }).sort((a, b) => healthOrder[a.health] - healthOrder[b.health] || (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31') || a.epicKey.localeCompare(b.epicKey));
  const pickerOptions = rows.map((row) => ({ key: row.epicKey, title: row.title, health: row.health, targetDate: row.targetDate, remainingPoints: row.remainingPoints }));
  const peakUtilization = projection.weeks.reduce((peak, week) => Math.max(peak, week.capacity ? week.load / week.capacity : 0), 0);
  return { activeEpicCount: rows.length, remainingPoints: rows.reduce((sum, row) => sum + row.remainingPoints, 0), unestimatedItems: rows.reduce((sum, row) => sum + row.unestimatedItems, 0), peakUtilization, overloadedWeekCount: projection.weeks.filter((week) => week.slack < 0).length, rows, weeks: projection.weeks, pickerOptions };
}
