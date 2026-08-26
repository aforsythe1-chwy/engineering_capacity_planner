import { diffDays, type StandupSprintProgressContext } from '@ecp/shared';

export const PROGRESS_SIGNAL_GAP = 10;
const percent = (value: number, total: number) => total > 0 && Number.isFinite(value) ? Math.max(0, Math.min(100, value / total * 100)) : null;
export type SprintProgressModel = { state: 'unavailable' | 'empty' | 'ready'; totalItems: number; estimatedItems: number; unestimatedItems: number; totalPoints: number; points: Record<'Done' | 'In Review' | 'In Progress' | 'To Do', number>; donePercent: number | null; reviewPercent: number | null; totalDays: number | null; elapsedDays: number | null; elapsedPercent: number | null; signal: string | null; accessibleSummary: string };

export function deriveStandupSprintProgress(context: StandupSprintProgressContext | null, sessionDate: string): SprintProgressModel {
  if (!context || context.freshness === 'unavailable') return { state: 'unavailable', totalItems: 0, estimatedItems: 0, unestimatedItems: 0, totalPoints: 0, points: { Done: 0, 'In Review': 0, 'In Progress': 0, 'To Do': 0 }, donePercent: null, reviewPercent: null, totalDays: null, elapsedDays: null, elapsedPercent: null, signal: null, accessibleSummary: 'Sprint progress is unavailable.' };
  const points = { Done: 0, 'In Review': 0, 'In Progress': 0, 'To Do': 0 };
  let estimatedItems = 0; let unestimatedItems = 0;
  for (const item of context.items) { if (item.points === null || !Number.isFinite(item.points) || item.points < 0) unestimatedItems++; else { estimatedItems++; points[item.normalizedStatus] += item.points; } }
  const totalPoints = Object.values(points).reduce((sum, value) => sum + value, 0);
  const donePercent = percent(points.Done, totalPoints); const reviewPercent = percent(points.Done + points['In Review'], totalPoints);
  const totalDays = context.startDate && context.endDate ? Math.max(1, diffDays(context.startDate, context.endDate) + 1) : null;
  const rawElapsed = totalDays && context.startDate ? diffDays(context.startDate, sessionDate) + 1 : null;
  const elapsedDays = rawElapsed === null || totalDays === null ? null : Math.max(0, Math.min(totalDays, rawElapsed)); const elapsedPercent = elapsedDays === null || totalDays === null ? null : percent(elapsedDays, totalDays);
  const signal = context.truncated || reviewPercent === null || elapsedPercent === null ? null : reviewPercent - elapsedPercent >= PROGRESS_SIGNAL_GAP ? 'Progress is ahead of elapsed time.' : elapsedPercent - reviewPercent > PROGRESS_SIGNAL_GAP ? 'Progress is behind elapsed time.' : 'Progress is close to elapsed time.';
  const state = context.items.length === 0 ? 'empty' : 'ready';
  return { state, totalItems: context.items.length, estimatedItems, unestimatedItems, totalPoints, points, donePercent, reviewPercent, totalDays, elapsedDays, elapsedPercent, signal, accessibleSummary: `${totalPoints} estimated points across ${context.items.length} items. Done ${points.Done} points. Done plus review ${points.Done + points['In Review']} points.${elapsedDays !== null && totalDays !== null ? ` Day ${elapsedDays} of ${totalDays}.` : ' Sprint dates unavailable.'}` };
}
