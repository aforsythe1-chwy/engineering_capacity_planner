import type { PortfolioHealth, PortfolioProjection } from '@ecp/engine';
import { effectivePortfolioEpic, type DomainDataset, type ImportantDateIconKey, type IsoDate, type TeamHoliday } from '@ecp/shared';

export type PortfolioCalendarEventKind = 'important-date' | 'holiday' | 'gating' | 'milestone' | 'dev-complete';
export type PortfolioCalendarEvent = {
  id: string; sourceId: string; date: IsoDate; epicKey: null; label: string; kind: 'important-date'; iconKey: ImportantDateIconKey; notes: string | null; linkUrl: string | null;
} | {
  id: string; sourceId: string; date: IsoDate; epicKey: null; label: string; kind: 'holiday'; holidayId: string; teamId: string; teamName: string; observed: boolean;
} | {
  id: string;
  sourceId: string;
  date: IsoDate;
  epicKey: string;
  label: string;
  kind: Exclude<PortfolioCalendarEventKind, 'important-date' | 'holiday'>;
  health?: PortfolioHealth;
};
export interface PortfolioCalendarWeek {
  start: IsoDate;
  end: IsoDate;
  capacity: number;
  totalLoad: number;
  selectedLoad: number | null;
  slack: number;
  contributingEpicKeys: string[];
}
export interface PortfolioCalendarSprint {
  id: string;
  name: string;
  teamName: string;
  start: IsoDate;
  end: IsoDate;
}
export interface PortfolioCalendarModel {
  today: IsoDate;
  events: PortfolioCalendarEvent[];
  weeks: PortfolioCalendarWeek[];
  /** Stored team cadence, kept independent from the current epic filter. */
  sprints: PortfolioCalendarSprint[];
  /** Rules are expanded by the shared month calendar for its current view. */
  holidays: TeamHoliday[];
  teamNames: Map<string, string>;
  hasVisibleDatedEvents: boolean;
}

export const PORTFOLIO_CALENDAR_KIND_ORDER: Record<PortfolioCalendarEventKind, number> = { 'important-date': 0, holiday: 1, gating: 2, 'dev-complete': 3, milestone: 4 };

export function buildPortfolioCalendarModel(
  dataset: DomainDataset,
  projection: PortfolioProjection,
  selectedKeys: readonly string[],
  today: IsoDate,
): PortfolioCalendarModel {
  const activeKeys = new Set(dataset.epics.filter((epic) => effectivePortfolioEpic(dataset, epic.key).tracked).map((epic) => epic.key));
  const selected = new Set(selectedKeys.filter((key) => activeKeys.has(key)));
  const visibleKeys = selected.size ? selected : activeKeys;
  const timelineKeys = new Set(dataset.epics
    .filter((epic) => visibleKeys.has(epic.key) && effectivePortfolioEpic(dataset, epic.key).planningKind === 'timeline')
    .map((epic) => epic.key));
  const events: PortfolioCalendarEvent[] = [];
  for (const date of dataset.importantDates ?? []) {
    events.push({ id: `important-date:${date.id}`, sourceId: date.id, date: date.date, epicKey: null, label: date.name, kind: 'important-date', iconKey: date.iconKey, notes: date.notes ?? null, linkUrl: date.linkUrl ?? null });
  }

  for (const milestone of dataset.milestones) {
    if (!timelineKeys.has(milestone.epicKey)) continue;
    events.push({
      id: `milestone:${milestone.id}`,
      sourceId: milestone.id,
      date: milestone.date,
      epicKey: milestone.epicKey,
      label: `${milestone.epicKey} · ${milestone.name}`,
      kind: milestone.isGating ? 'gating' : 'milestone',
    });
  }
  for (const result of projection.epics) {
    if (!timelineKeys.has(result.epicKey) || !result.projectedDevCompleteDate) continue;
    events.push({
      id: `dev-complete:${result.epicKey}`,
      sourceId: result.epicKey,
      date: result.projectedDevCompleteDate,
      epicKey: result.epicKey,
      label: `${result.epicKey} · Dev-complete`,
      kind: 'dev-complete',
      health: result.health,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date)
    || PORTFOLIO_CALENDAR_KIND_ORDER[a.kind] - PORTFOLIO_CALENDAR_KIND_ORDER[b.kind]
    || (a.epicKey ?? '').localeCompare(b.epicKey ?? '')
    || a.id.localeCompare(b.id));

  const weeks = projection.weeks.map((week) => ({
    start: week.start,
    end: week.end,
    capacity: week.capacity,
    totalLoad: week.load,
    selectedLoad: selected.size
      ? week.contributions.filter((entry) => selected.has(entry.epicKey)).reduce((sum, entry) => sum + entry.load, 0)
      : null,
    slack: week.slack,
    contributingEpicKeys: week.contributions.map((entry) => entry.epicKey).sort(),
  }));
  const activeTeamIds = new Set(dataset.epics.filter((epic) => activeKeys.has(epic.key)).map((epic) => epic.teamId));
  const teamNames = new Map(dataset.teams.map((team) => [team.id, team.name]));
  const sprints = (dataset.sprints ?? []).filter((sprint) => activeTeamIds.has(sprint.teamId)).map((sprint) => ({
    id: sprint.id, name: sprint.name, teamName: teamNames.get(sprint.teamId) ?? sprint.teamId, start: sprint.startDate, end: sprint.endDate,
  })).sort((a, b) => a.start.localeCompare(b.start) || a.teamName.localeCompare(b.teamName) || a.id.localeCompare(b.id));
  return { today, events, weeks, sprints, holidays: dataset.holidays ?? [], teamNames, hasVisibleDatedEvents: events.length > 0 || (dataset.holidays?.length ?? 0) > 0 };
}
