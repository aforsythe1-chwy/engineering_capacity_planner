import type {
  IsoDate,
  Oncall,
  PlannedPlacement,
  Pto,
  Sprint,
  Team,
  TeamHoliday,
  TeamMember,
  UserStory,
  VelocityOverride,
  WorkItem,
} from '@ecp/shared';
import { addDays } from '@ecp/shared';
import { buildCapacityContext, weeklyPlan, type WeekPlan } from '@ecp/engine';

export interface GanttLabelConfig {
  applyParentLabels: boolean;
  ignoreLabels: string[];
}

/**
 * Gantt inputs keep presentation scope separate from the portfolio-wide load.
 * Filtering changes only the visible collections; capacity is always derived
 * from the complete active portfolio collections.
 */
export interface GanttScope {
  visibleStories: UserStory[];
  visibleWorkItems: WorkItem[];
  visiblePlacements: PlannedPlacement[];
  portfolioWorkItems: WorkItem[];
  portfolioPlacements: PlannedPlacement[];
  labelConfigByEpicKey: ReadonlyMap<string, GanttLabelConfig>;
  team: Team;
  members: TeamMember[];
  pto: Pto[];
  oncall: Oncall[];
  velocityOverrides: VelocityOverride[];
  holidays?: TeamHoliday[];
  sprints: Sprint[];
  defaults: {
    oncallMultiplier: number;
    weekYellowLoadFraction: number;
  };
  planningToday: IsoDate | null;
}

/**
 * View-model for the Gantt Planner tab (project plan §6a). Given a Gantt scope
 * and a selected sprint, it derives the week columns (capacity + placed load +
 * verdict), the horizontal label lanes, the placed chips per `(lane × week)`
 * cell, the per-member weekly-capacity breakdown, and the unplaced backlog
 * "bag". Pure — it runs the engine's `weeklyPlan` in the browser so the board
 * recomputes live, mirroring `projection.ts` for the timeline.
 */

/** No label → this catch-all lane. */
export const UNLABELED = 'Unlabeled';

function effectiveLabels(
  w: WorkItem,
  story: UserStory | undefined,
  applyParentLabels: boolean,
  ignored: ReadonlySet<string>,
): string[] {
  const labels = [...(w.labels ?? [])];
  if (applyParentLabels) labels.push(...(story?.labels ?? []));
  return [...new Set(labels.map((l) => l.trim()).filter((l) => l !== '' && !ignored.has(l)))];
}

const primaryLabel = (
  w: WorkItem,
  story: UserStory | undefined,
  applyParentLabels: boolean,
  ignored: ReadonlySet<string>,
): string => effectiveLabels(w, story, applyParentLabels, ignored)[0] ?? UNLABELED;

const isDone = (w: WorkItem): boolean => w.status === 'Done';

/** A horizontal lane: an epic subdivision sourced from a label. */
export interface GanttLane {
  label: string;
  /** Total points of the subdivision across the visible work. */
  totalPoints: number;
}

/** Placed chips in one `(lane × week)` cell. */
export interface GanttCell {
  items: WorkItem[];
  /** Remaining (not-done) points placed in the cell. */
  points: number;
}

/** One member's weekly-capacity breakdown for the displayed Gantt horizon. */
export interface MemberWeekCapacity {
  member: TeamMember;
  /** Capacity per week index, in points. */
  perWeek: number[];
  total: number;
  /** PTO / on-call / velocity-override call-outs overlapping the sprint. */
  notes: string[];
}

export interface GanttView {
  sprint: Sprint | null;
  /** Consecutive sprints represented in the displayed horizon. */
  sprintGroups: Array<{ sprint: Sprint; startWeekIndex: number; weekCount: number }>;
  weeks: GanttWeek[];
  lanes: GanttLane[];
  /** Cell lookup, keyed by `${laneLabel}::${weekIndex}`. */
  cells: Map<string, GanttCell>;
  members: MemberWeekCapacity[];
  /** Unplaced, not-done items — the backlog "bag". */
  bag: WorkItem[];
  placedCount: number;
}

/** A displayed week, identified by both its global column and sprint-local week. */
export interface GanttWeek extends WeekPlan {
  sprintId: string;
  sprintName: string;
  sprintWeekIndex: number;
}

const cellKey = (label: string, weekIndex: number): string => `${label}::${weekIndex}`;

export function ganttSprintEnd(sprint: Sprint, sprintLengthDays: number): IsoDate {
  if (!Number.isFinite(sprintLengthDays) || sprintLengthDays <= 0) return sprint.endDate;
  const cadenceEnd = addDays(sprint.startDate, Math.max(1, Math.round(sprintLengthDays)) - 1);
  return cadenceEnd < sprint.endDate ? cadenceEnd : sprint.endDate;
}

/** Build the Gantt view from the selected sprint across a configurable horizon. */
export function buildGanttView(
  scope: GanttScope,
  sprintId: string | null,
  displayedWeekCount = 4,
): GanttView {
  const sprint = scope.sprints.find((s) => s.id === sprintId) ?? scope.sprints[0] ?? null;
  const sprintStartIndex = sprint ? scope.sprints.findIndex((entry) => entry.id === sprint.id) : -1;

  const visibleByKey = new Map(scope.visibleWorkItems.map((w) => [w.key, w]));
  const portfolioByKey = new Map(scope.portfolioWorkItems.map((w) => [w.key, w]));
  const storyByKey = new Map(scope.visibleStories.map((s) => [s.key, s]));
  const laneLabel = (w: WorkItem): string => {
    const story = storyByKey.get(w.storyKey);
    const config = story ? scope.labelConfigByEpicKey.get(story.epicKey) : undefined;
    return primaryLabel(
      w,
      story,
      config?.applyParentLabels ?? false,
      new Set(config?.ignoreLabels ?? []),
    );
  };
  const ctx = buildCapacityContext({
    members: scope.members,
    pto: scope.pto,
    oncall: scope.oncall,
    velocityOverrides: scope.velocityOverrides,
    holidays: scope.holidays ?? [],
    oncallMultiplier: scope.defaults.oncallMultiplier,
  });

  const cells = new Map<string, GanttCell>();
  const placedKeys = new Set<string>();
  const sprintGroups: GanttView['sprintGroups'] = [];
  const weeks: GanttWeek[] = [];
  let remainingWeeks = Math.max(1, Math.floor(displayedWeekCount));

  // Visible placements produce cells. Portfolio placements independently
  // produce shared weekly loads, including work hidden by an epic filter.
  for (const candidate of sprintStartIndex < 0 ? [] : scope.sprints.slice(sprintStartIndex)) {
    if (remainingWeeks <= 0) break;
    const visiblePlacementsHere = scope.visiblePlacements.filter((p) => p.sprintId === candidate.id);
    const portfolioPlacementsHere = scope.portfolioPlacements.filter((p) => p.sprintId === candidate.id);
    const placedPointsByWeek = new Map<number, number>();
    for (const p of portfolioPlacementsHere) {
      const item = portfolioByKey.get(p.workItemKey);
      if (!item || isDone(item)) continue;
      placedPointsByWeek.set(p.weekIndex, (placedPointsByWeek.get(p.weekIndex) ?? 0) + item.points);
    }
    const sprintWeeks = weeklyPlan({
      startDate: candidate.startDate,
      endDate: ganttSprintEnd(candidate, scope.team.sprintLengthDays),
      workingDays: scope.team.workingDays,
      capacityCtx: ctx,
      placedPointsByWeek,
      yellowLoadFraction: scope.defaults.weekYellowLoadFraction,
    }).slice(0, remainingWeeks);
    if (sprintWeeks.length === 0) continue;

    const startWeekIndex = weeks.length;
    sprintGroups.push({ sprint: candidate, startWeekIndex, weekCount: sprintWeeks.length });
    for (const p of visiblePlacementsHere) {
      if (p.weekIndex < 0 || p.weekIndex >= sprintWeeks.length) continue;
      const item = visibleByKey.get(p.workItemKey);
      if (!item) continue;
      placedKeys.add(item.key);
      const key = cellKey(laneLabel(item), startWeekIndex + p.weekIndex);
      const cell = cells.get(key) ?? { items: [], points: 0 };
      cell.items.push(item);
      if (!isDone(item)) cell.points += item.points;
      cells.set(key, cell);
    }
    weeks.push(...sprintWeeks.map((week, sprintWeekIndex) => ({
      ...week,
      index: startWeekIndex + sprintWeekIndex,
      sprintId: candidate.id,
      sprintName: candidate.name,
      sprintWeekIndex,
    })));
    remainingWeeks -= sprintWeeks.length;
  }

  // Lanes: distinct labels across visible work, biggest subdivision first.
  const totals = new Map<string, number>();
  for (const w of scope.visibleWorkItems) {
    const label = laneLabel(w);
    totals.set(label, (totals.get(label) ?? 0) + w.points);
  }
  const lanes: GanttLane[] = [...totals.entries()]
    .map(([label, totalPoints]) => ({ label, totalPoints }))
    .sort((a, b) => b.totalPoints - a.totalPoints || a.label.localeCompare(b.label));

  const members = sprintGroups.length
    ? scope.members
        .filter((m) => m.active)
        .map((m) => memberWeekCapacity(m, sprintGroups, scope))
    : [];

  // The bag: unplaced (in any sprint), not-done work.
  const allVisiblePlaced = new Set(scope.visiblePlacements.map((p) => p.workItemKey));
  const bag = scope.visibleWorkItems.filter((w) => !allVisiblePlaced.has(w.key) && !isDone(w));

  return { sprint, sprintGroups, weeks, lanes, cells, members, bag, placedCount: placedKeys.size };
}

/** Look up a cell (may be empty). */
export function ganttCell(
  view: GanttView,
  laneLabel: string,
  weekIndex: number,
): GanttCell | undefined {
  return view.cells.get(cellKey(laneLabel, weekIndex));
}

/** Per-week capacity for a single member, plus availability call-outs. */
function memberWeekCapacity(
  member: TeamMember,
  sprintGroups: GanttView['sprintGroups'],
  scope: GanttScope,
): MemberWeekCapacity {
  const soloCtx = buildCapacityContext({
    members: [member],
    pto: scope.pto.filter((p) => p.memberId === member.id),
    oncall: scope.oncall.filter((o) => o.memberId === member.id),
    velocityOverrides: scope.velocityOverrides.filter((v) => v.memberId === member.id),
    holidays: scope.holidays ?? [],
    oncallMultiplier: scope.defaults.oncallMultiplier,
  });
  const perWeek = sprintGroups.flatMap(({ sprint }) => weeklyPlan({
    startDate: sprint.startDate,
    endDate: ganttSprintEnd(sprint, scope.team.sprintLengthDays),
    workingDays: scope.team.workingDays,
    capacityCtx: soloCtx,
    placedPointsByWeek: new Map(),
    yellowLoadFraction: scope.defaults.weekYellowLoadFraction,
  }).map((week) => week.capacity));
  const total = Math.round(perWeek.reduce((a, b) => a + b, 0) * 100) / 100;

  const overlaps = (start: IsoDate, end: IsoDate): boolean =>
    sprintGroups.some(({ sprint }) =>
      start <= ganttSprintEnd(sprint, scope.team.sprintLengthDays) && end >= sprint.startDate,
    );
  const notes: string[] = [];
  for (const p of scope.pto) {
    if (p.memberId === member.id && overlaps(p.startDate, p.endDate)) {
      notes.push(`PTO ${p.startDate} → ${p.endDate}${p.note ? ` (${p.note})` : ''}`);
    }
  }
  for (const o of scope.oncall) {
    if (o.memberId === member.id && overlaps(o.startDate, o.endDate)) {
      notes.push(`On-call ${o.startDate} → ${o.endDate}${o.note ? ` (${o.note})` : ''}`);
    }
  }
  for (const v of scope.velocityOverrides) {
    if (v.memberId === member.id && overlaps(v.startDate, v.endDate)) {
      notes.push(`×${v.multiplier} ${v.startDate} → ${v.endDate}${v.note ? ` (${v.note})` : ''}`);
    }
  }

  return { member, perWeek, total, notes };
}
