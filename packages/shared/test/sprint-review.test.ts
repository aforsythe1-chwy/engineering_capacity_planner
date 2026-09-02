import { describe, expect, it } from 'vitest';
import { summarizeSprintReview } from '../src/sprint-review.js';
describe('summarizeSprintReview', () => it('keeps commitment, scope change, epic and member results truthful', () => {
  const result = summarizeSprintReview([{ key: 'A', points: 3, status: 'To Do', epicKey: 'E1', assigneeMemberId: 'M1', assigneeMemberName: 'Ada Lovelace' }, { key: 'B', points: 2, status: 'To Do', epicKey: null, assigneeMemberId: null }], [{ key: 'A', points: 3, status: 'Done', epicKey: 'E1', assigneeMemberId: 'M1' }, { key: 'C', points: 5, status: 'In Progress', epicKey: 'E2', assigneeMemberId: 'M2' }]);
  expect(result).toMatchObject({ baselineCaptured: true, addedKeys: ['C'], removedKeys: ['B'], committedPoints: 5, completedCommittedPoints: 3, statusCounts: { Done: 1, 'In Progress': 1 }, statusPoints: { Done: 3, 'In Progress': 5 }, epicRows: [{ key: 'E1', committedPoints: 3, donePoints: 3 }, { key: 'Unattributed', committedPoints: 2, unfinishedPoints: 2 }], memberRows: [{ key: 'M1', label: 'Ada Lovelace' }, { key: 'Unassigned' }] });
}));
