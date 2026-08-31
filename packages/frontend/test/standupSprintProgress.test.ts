import { describe, expect, it } from 'vitest';
import type { StandupSprintProgressContext } from '@ecp/shared';
import { deriveStandupSprintProgress } from '../src/lib/standupSprintProgress';

const context: StandupSprintProgressContext = { sprintId: '42', sprintName: 'Sprint 42', startDate: '2026-08-18', endDate: '2026-08-27', capturedAt: '2026-08-23T12:00:00Z', source: 'jira', freshness: 'fresh', errorMessage: null, truncated: false, items: [
  { key: 'A-1', summary: 'Done', issueType: 'Story', status: 'Done', normalizedStatus: 'Done', points: 18, assigneeAccountId: null, assigneeName: null, url: null },
  { key: 'A-2', summary: 'Review', issueType: 'Story', status: 'In Review', normalizedStatus: 'In Review', points: 9, assigneeAccountId: null, assigneeName: null, url: null },
  { key: 'A-3', summary: 'Working', issueType: 'Story', status: 'In Progress', normalizedStatus: 'In Progress', points: 15, assigneeAccountId: null, assigneeName: null, url: null },
  { key: 'A-4', summary: 'Unknown estimate', issueType: 'Story', status: 'To Do', normalizedStatus: 'To Do', points: null, assigneeAccountId: null, assigneeName: null, url: null },
] };

describe('deriveStandupSprintProgress', () => {
  it('derives inclusive time and excludes unestimated work from point ratios', () => {
    const result = deriveStandupSprintProgress(context, '2026-08-23');
    expect(result).toMatchObject({ state: 'ready', totalItems: 4, unestimatedItems: 1, totalPoints: 42, elapsedDays: 6, totalDays: 10, donePercent: 42.857142857142854, reviewPercent: 64.28571428571429, inProgressPercent: 100, toDoPercent: 100, signal: 'Progress is close to elapsed time.' });
  });
  it('clamps calendar time and suppresses a signal for partial data', () => {
    const result = deriveStandupSprintProgress({ ...context, truncated: true }, '2026-09-01');
    expect(result.elapsedPercent).toBe(100); expect(result.signal).toBeNull();
  });
});
