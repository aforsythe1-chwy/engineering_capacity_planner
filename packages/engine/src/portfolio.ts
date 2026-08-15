import type { DomainDataset, IsoDate, WorkItem } from '@ecp/shared';
import { addDays, effectivePortfolioEpic, isWorkingDay, workingDaysBetween } from '@ecp/shared';
import { buildCapacityContext, dayCapacity } from './capacity.js';
import { makeSprintCache, sprintIndexFor } from './calendar.js';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from './config.js';
import { readEngineConfig } from './adapter.js';

export type PortfolioHealth = 'green' | 'yellow' | 'red' | 'needs-target' | 'needs-estimates' | 'needs-plan' | 'ongoing';
export interface PortfolioEpicProjection { epicKey: string; health: PortfolioHealth; reason: string; projectedDevCompleteDate: IsoDate | null; bufferWorkingDays: number | null; remainingPoints: number; unestimatedItems: number; placedPoints: number; unplannedPoints: number; }
export interface PortfolioWeekContribution { epicKey: string; load: number; }
export interface PortfolioWeekLoad { start: IsoDate; end: IsoDate; capacity: number; load: number; slack: number; contributions: PortfolioWeekContribution[]; }
export interface PortfolioMemberLoad { memberId: string; weeks: Array<PortfolioWeekLoad & { load: number }>; }
export interface PortfolioProjection { epics: PortfolioEpicProjection[]; weeks: PortfolioWeekLoad[]; members: PortfolioMemberLoad[]; unscheduledItemKeys: string[]; }

const round = (n: number) => Math.round(n * 100) / 100;
function calendarWeek(day: IsoDate): { start: IsoDate; end: IsoDate } { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); const start = date.toISOString().slice(0, 10); date.setUTCDate(date.getUTCDate() + 6); return { start, end: date.toISOString().slice(0, 10) }; }
function addLoad(bucket: PortfolioWeekLoad, epicKey: string, load: number): void { bucket.load += load; const c = bucket.contributions.find((entry) => entry.epicKey === epicKey); if (c) c.load += load; else bucket.contributions.push({ epicKey, load }); }

/**
 * Shared-capacity forecast. Ongoing work uses its dated placement as an
 * authoritative reservation before target-ordered timeline work is allocated.
 * Unplaced ongoing work remains explicit rather than receiving an invented end
 * date or silently disappearing from the load model.
 */
export function projectPortfolioFromDataset(dataset: DomainDataset, today: IsoDate): PortfolioProjection {
  const active = dataset.epics.filter((epic) => effectivePortfolioEpic(dataset, epic.key).tracked);
  const byStory = new Map(dataset.stories.map((story) => [story.key, story]));
  const itemsByEpic = new Map(active.map((epic) => [epic.key, [] as WorkItem[]]));
  for (const item of dataset.workItems) { const epicKey = byStory.get(item.storyKey)?.epicKey; if (epicKey && itemsByEpic.has(epicKey)) itemsByEpic.get(epicKey)!.push(item); }
  const placementByItem = new Map(dataset.placements.map((placement) => [placement.workItemKey, placement]));
  const results = new Map<string, PortfolioEpicProjection>();
  const candidates: Array<{ item: WorkItem; epicKey: string; target: IsoDate; priority: number }> = [];
  const reservations = new Map<string, Array<{ epicKey: string; load: number }>>();
  const unscheduled: string[] = [];

  for (const epic of active) {
    const kind = effectivePortfolioEpic(dataset, epic.key).planningKind;
    const items = itemsByEpic.get(epic.key)!; const remaining = items.filter((item) => item.status !== 'Done');
    const unestimatedItems = remaining.filter((item) => item.isEstimated === false).length;
    const placedItems = remaining.filter((item) => placementByItem.has(item.key));
    const remainingPoints = remaining.reduce((sum, item) => sum + item.points, 0);
    const placedPoints = placedItems.reduce((sum, item) => sum + item.points, 0);
    const unplannedPoints = remaining.filter((item) => !placementByItem.has(item.key)).reduce((sum, item) => sum + item.points, 0);
    const gating = dataset.milestones.find((milestone) => milestone.epicKey === epic.key && milestone.isGating);
    const health: PortfolioHealth = unestimatedItems ? 'needs-estimates' : kind === 'ongoing' ? (unplannedPoints ? 'needs-plan' : 'ongoing') : !gating ? 'needs-target' : 'needs-plan';
    const reason = unestimatedItems ? `${unestimatedItems} remaining item(s) need estimates.` : kind === 'ongoing' ? (unplannedPoints ? 'Ongoing work needs dated placement before its capacity can be reserved.' : 'Ongoing work is represented by its dated capacity reservations.') : !gating ? 'No gating milestone is configured.' : 'Awaiting shared-capacity schedule.';
    results.set(epic.key, { epicKey: epic.key, health, reason, projectedDevCompleteDate: null, bufferWorkingDays: null, remainingPoints, unestimatedItems, placedPoints, unplannedPoints });
    if (kind === 'timeline' && gating && !unestimatedItems) for (const item of remaining) if (item.points > 0) candidates.push({ item, epicKey: epic.key, target: gating.date, priority: effectivePortfolioEpic(dataset, epic.key).priority });
    if (kind === 'ongoing') for (const item of placedItems) {
      const placement = placementByItem.get(item.key)!; const sprint = dataset.sprints.find((entry) => entry.id === placement.sprintId);
      if (!sprint || item.points <= 0) { if (item.points > 0) unscheduled.push(item.key); continue; }
      const start = addDays(sprint.startDate, placement.weekIndex * 7); const end = start > sprint.endDate ? start : (addDays(start, 6) < sprint.endDate ? addDays(start, 6) : sprint.endDate);
      const team = dataset.teams.find((entry) => entry.id === epic.teamId)!;
      const days: IsoDate[] = []; for (let day = start; day <= end; day = addDays(day, 1)) if (isWorkingDay(day, team.workingDays)) days.push(day);
      if (!days.length) { unscheduled.push(item.key); continue; }
      for (const day of days) { const loads = reservations.get(day) ?? []; loads.push({ epicKey: epic.key, load: item.points / days.length }); reservations.set(day, loads); }
    }
  }
  candidates.sort((a, b) => a.target.localeCompare(b.target) || a.priority - b.priority || a.item.key.localeCompare(b.item.key));
  const weeks = new Map<string, PortfolioWeekLoad>(); const completion = new Map<string, IsoDate>();
  const byTeam = new Map(active.map((epic) => [epic.teamId, active.filter((entry) => entry.teamId === epic.teamId)]));
  for (const [teamId, epics] of byTeam) {
    const team = dataset.teams.find((entry) => entry.id === teamId)!; const memberIds = new Set(dataset.members.filter((member) => member.teamId === teamId).map((member) => member.id));
    const cfg: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...readEngineConfig(dataset) };
    const ctx = buildCapacityContext({ members: dataset.members.filter((member) => member.teamId === teamId), pto: dataset.pto.filter((entry) => memberIds.has(entry.memberId)), oncall: dataset.oncall.filter((entry) => memberIds.has(entry.memberId)), velocityOverrides: dataset.velocityOverrides.filter((entry) => memberIds.has(entry.memberId)), oncallMultiplier: cfg.oncallMultiplier });
    const getSprint = makeSprintCache(team); let day = today; let remaining = candidates.filter((candidate) => epics.some((epic) => epic.key === candidate.epicKey)).map((candidate) => ({ ...candidate, left: candidate.item.points }));
    const finalReservation = [...reservations.keys()].filter((date) => date >= today).sort().at(-1);
    for (let i = 0; i <= cfg.maxHorizonDays && (remaining.length || (finalReservation && day <= finalReservation)); i++, day = addDays(day, 1)) {
      if (!isWorkingDay(day, team.workingDays)) continue;
      const week = calendarWeek(day); const bucket = weeks.get(week.start) ?? { ...week, capacity: 0, load: 0, slack: 0, contributions: [] };
      const rawCapacity = dayCapacity(day, getSprint(sprintIndexFor(day, team)), ctx); bucket.capacity += rawCapacity;
      const reserved = (reservations.get(day) ?? []).filter((entry) => epics.some((epic) => epic.key === entry.epicKey));
      for (const entry of reserved) addLoad(bucket, entry.epicKey, entry.load);
      let capacity = Math.max(0, rawCapacity - reserved.reduce((sum, entry) => sum + entry.load, 0));
      for (const job of remaining) { if (capacity <= 1e-9) break; const used = Math.min(capacity, job.left); job.left -= used; capacity -= used; addLoad(bucket, job.epicKey, used); if (job.left <= 1e-9) completion.set(job.epicKey, day); }
      weeks.set(week.start, bucket); remaining = remaining.filter((job) => job.left > 1e-9);
    }
    unscheduled.push(...remaining.map((job) => job.item.key));
  }
  for (const epic of active) { const result = results.get(epic.key)!; if (effectivePortfolioEpic(dataset, epic.key).planningKind !== 'timeline' || result.health !== 'needs-plan') continue; const gate = dataset.milestones.find((m) => m.epicKey === epic.key && m.isGating)!; const done = completion.get(epic.key); if (!done && result.remainingPoints > 0) { result.health = 'red'; result.reason = 'Work is unreachable within the configured planning horizon.'; continue; } const buffer = done ? workingDaysBetween(done, gate.date, dataset.teams.find((team) => team.id === epic.teamId)!.workingDays) : 0; result.projectedDevCompleteDate = done ?? today; result.bufferWorkingDays = buffer; result.health = buffer < 0 ? 'red' : buffer < (readEngineConfig(dataset).greenMinBufferDays ?? 5) ? 'yellow' : 'green'; result.reason = buffer < 0 ? `Projected completion is ${-buffer} working day(s) after the gating milestone.` : `${buffer} working day(s) of buffer before the gating milestone.`; }
  const weekList = [...weeks.values()].map((week) => ({ ...week, capacity: round(week.capacity), load: round(week.load), slack: round(week.capacity - week.load), contributions: week.contributions.map((entry) => ({ ...entry, load: round(entry.load) })).sort((a, b) => a.epicKey.localeCompare(b.epicKey)) })).sort((a, b) => a.start.localeCompare(b.start));
  return { epics: [...results.values()], weeks: weekList, members: [], unscheduledItemKeys: [...new Set(unscheduled)] };
}
