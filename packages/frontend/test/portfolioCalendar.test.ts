import { describe, expect, it } from 'vitest';
import type { PortfolioProjection } from '@ecp/engine';
import type { DomainDataset } from '@ecp/shared';
import { buildPortfolioCalendarModel } from '../src/lib/portfolioCalendar';

const dataset: DomainDataset = {
  teams: [{ id: 'team', name: 'Platform', sprintLengthDays: 14, sprintStartWeekday: 1, sprintAnchorDate: '2026-09-01', workingDays: [1, 2, 3, 4, 5] }], members: [], velocityOverrides: [], pto: [], oncall: [], stories: [], workItems: [], dependencies: [], sprints: [{ id: 'sprint-1', teamId: 'team', name: 'September sprint', startDate: '2026-09-01', endDate: '2026-09-14' }], placements: [], settings: [],
  epics: [
    { key: 'A-1', title: 'Alpha', teamId: 'team' },
    { key: 'B-2', title: 'Beta', teamId: 'team' },
    { key: 'OPS-3', title: 'Operations', teamId: 'team' },
  ],
  portfolioEpics: [
    { epicKey: 'A-1', planningKind: 'timeline', priority: 1, scopeOverride: 'include' },
    { epicKey: 'B-2', planningKind: 'timeline', priority: 2, scopeOverride: 'include' },
    { epicKey: 'OPS-3', planningKind: 'ongoing', priority: 3, scopeOverride: 'include' },
  ],
  milestones: [
    { id: 'a-gate', epicKey: 'A-1', name: 'Launch', date: '2026-09-10', isGating: true },
    { id: 'a-demo', epicKey: 'A-1', name: 'Demo', date: '2026-09-10', isGating: false },
    { id: 'b-gate', epicKey: 'B-2', name: 'Release', date: '2026-10-01', isGating: true },
    { id: 'ops-old', epicKey: 'OPS-3', name: 'Dormant date', date: '2026-09-01', isGating: true },
  ],
  importantDates: [{ id: 'planning', name: 'Quarterly planning', date: '2026-09-10', iconKey: 'users' }],
};
const projection: PortfolioProjection = {
  epics: [
    { epicKey: 'A-1', health: 'green', reason: '', projectedDevCompleteDate: '2026-09-10', bufferWorkingDays: 2, remainingPoints: 8, jiraEstimatedRemainingPoints: 8, unrefinedRemainingPoints: 0, modeledRemainingPoints: 8, unestimatedItems: 0, estimateReviewRequired: false, estimateReviewChanges: [], placedPoints: 0, unplannedPoints: 8 },
    { epicKey: 'B-2', health: 'needs-estimates', reason: '', projectedDevCompleteDate: null, bufferWorkingDays: null, remainingPoints: 5, jiraEstimatedRemainingPoints: 5, unrefinedRemainingPoints: 0, modeledRemainingPoints: 5, unestimatedItems: 1, estimateReviewRequired: false, estimateReviewChanges: [], placedPoints: 0, unplannedPoints: 5 },
    { epicKey: 'OPS-3', health: 'ongoing', reason: '', projectedDevCompleteDate: '2026-09-12', bufferWorkingDays: null, remainingPoints: 3, jiraEstimatedRemainingPoints: 3, unrefinedRemainingPoints: 0, modeledRemainingPoints: 3, unestimatedItems: 0, estimateReviewRequired: false, estimateReviewChanges: [], placedPoints: 3, unplannedPoints: 0 },
  ],
  weeks: [{ start: '2026-09-07', end: '2026-09-13', capacity: 50, load: 42, slack: 8, contributions: [{ epicKey: 'A-1', load: 12 }, { epicKey: 'B-2', load: 20 }, { epicKey: 'OPS-3', load: 10 }] }],
  members: [], unscheduledItemKeys: [],
};

describe('buildPortfolioCalendarModel', () => {
  it('shows all Timeline dates in deterministic kind order and omits ongoing dates', () => {
    const model = buildPortfolioCalendarModel(dataset, projection, [], '2026-09-01');
    expect(model.events.map((event) => [event.id, event.kind])).toEqual([
      ['important-date:planning', 'important-date'],
      ['milestone:a-gate', 'gating'],
      ['dev-complete:A-1', 'dev-complete'],
      ['milestone:a-demo', 'milestone'],
      ['milestone:b-gate', 'gating'],
    ]);
    expect(model.events.some((event) => event.epicKey === 'OPS-3')).toBe(false);
  });

  it('filters exact dates while preserving shared totals and exposing selected contribution', () => {
    const all = buildPortfolioCalendarModel(dataset, projection, [], '2026-09-01');
    const selected = buildPortfolioCalendarModel(dataset, projection, ['A-1'], '2026-09-01');
    expect(selected.events.every((event) => event.epicKey === 'A-1' || event.kind === 'important-date')).toBe(true);
    expect(selected.events.find((event) => event.kind === 'important-date')).toMatchObject({ label: 'Quarterly planning', iconKey: 'users' });
    expect(selected.weeks[0]).toMatchObject({ totalLoad: all.weeks[0]!.totalLoad, capacity: 50, slack: 8, selectedLoad: 12 });
    expect(all.weeks[0]!.selectedLoad).toBeNull();
    expect(selected.sprints).toEqual(all.sprints);
  });

  it('does not fabricate a completion event for planning-incomplete epics', () => {
    const model = buildPortfolioCalendarModel(dataset, projection, ['B-2'], '2026-09-01');
    expect(model.events.map((event) => event.kind)).toEqual(['important-date', 'gating']);
  });
});
