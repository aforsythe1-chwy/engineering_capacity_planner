import { describe, expect, it } from 'vitest';
import type { DomainDataset } from '@ecp/shared';
import { estimateReviewChanges, resolveEpicWorkload } from '../src/workload.js';
import { projectPortfolioFromDataset } from '../src/portfolio.js';

function data(): DomainDataset {
  return {
    teams: [{ id: 'team', name: 'Team', sprintLengthDays: 14, sprintStartWeekday: 2, sprintAnchorDate: '2026-01-06', workingDays: [1, 2, 3, 4, 5] }],
    members: [{ id: 'member', teamId: 'team', name: 'Member', baseVelocity: 10, active: true }],
    velocityOverrides: [], pto: [], oncall: [],
    epics: [{ key: 'EPIC-1', title: 'Epic', teamId: 'team' }],
    portfolioEpics: [{ epicKey: 'EPIC-1', scopeOverride: 'auto', planningKind: 'timeline', priority: 0 }],
    milestones: [{ id: 'gate', epicKey: 'EPIC-1', name: 'Launch', date: '2026-02-20', isGating: true }],
    stories: [{ key: 'STORY-1', epicKey: 'EPIC-1', title: 'Story' }],
    workItems: [{ key: 'ITEM-1', storyKey: 'STORY-1', title: 'Pointed', points: 25, status: 'To Do', assigneeId: 'member' }, { key: 'ITEM-2', storyKey: 'STORY-1', title: 'Unpointed', points: 0, isEstimated: false, status: 'To Do', assigneeId: 'member' }],
    dependencies: [], sprints: [], placements: [], settings: [],
  };
}

describe('resolveEpicWorkload', () => {
  it('adds Jira-estimated and explicit unrefined work without conflating zero with absence', () => {
    const dataset = data();
    expect(resolveEpicWorkload(dataset, 'EPIC-1')).toMatchObject({ jiraEstimatedRemainingPoints: 25, unrefinedRemainingPoints: 0, modeledRemainingPoints: 25, unestimatedJiraItems: 1, hasUnrefinedEstimate: false });
    dataset.epicEstimates = [{ epicKey: 'EPIC-1', unrefinedPoints: 25, reviewedFactBasis: { 'ITEM-1': 25, 'ITEM-2': null }, reviewedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
    expect(resolveEpicWorkload(dataset, 'EPIC-1')).toMatchObject({ jiraEstimatedRemainingPoints: 25, unrefinedRemainingPoints: 25, modeledRemainingPoints: 50, hasUnrefinedEstimate: true, estimateReviewRequired: false });
  });

  it('requires review only for scope expansion, newly pointed work, and point increases', () => {
    expect(estimateReviewChanges({ A: 3, B: null, C: 8 }, { A: 2, B: 5, C: 13, D: null })).toEqual([
      { key: 'B', kind: 'newly-estimated', previousPoints: null, currentPoints: 5 },
      { key: 'C', kind: 'points-increased', previousPoints: 8, currentPoints: 13 },
      { key: 'D', kind: 'new-item', previousPoints: null, currentPoints: null },
    ]);
  });

  it('uses the aggregate unrefined amount in timeline capacity without creating an item key', () => {
    const dataset = data();
    dataset.workItems = [];
    dataset.epicEstimates = [{ epicKey: 'EPIC-1', unrefinedPoints: 50, reviewedFactBasis: {}, reviewedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
    const projection = projectPortfolioFromDataset(dataset, '2026-01-06');
    expect(projection.epics[0]).toMatchObject({ modeledRemainingPoints: 50, unrefinedRemainingPoints: 50 });
    expect(projection.unscheduledItemKeys).toEqual([]);
    expect(projection.weeks.reduce((sum, week) => sum + week.load, 0)).toBe(50);
  });
});
