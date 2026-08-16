import { describe, expect, it } from 'vitest';
import { groupStandupTickets, mergeStatusDraft, standupTicketGroupTone, statusDraftErrors } from '../src/lib/standupStatusPresentation';

describe('standup status presentation', () => {
  const entries = [
    { statusId: 'progress', sourceName: 'In Progress', sourceCategory: 'indeterminate', sourceColumnName: 'Doing', friendlyName: 'Building' },
    { statusId: 'done', sourceName: 'Done', sourceCategory: 'done', sourceColumnName: 'Done', friendlyName: 'Wrapped up' },
  ];
  const ticket = (key: string, status: string, statusId: string | null, statusCategory = 'indeterminate') => ({ key, url: null, summary: key, status, statusId, statusCategory, assigneeAccountId: null, assigneeName: null, parentKey: null, parentSummary: null });

  it('uses configured order and labels, then appends unknown statuses deterministically', () => {
    const groups = groupStandupTickets([ticket('A', 'Done', 'done', 'done'), ticket('B', 'QA', 'qa'), ticket('C', 'In Progress', 'progress'), ticket('D', 'QA', 'qa')], entries);
    expect(groups.map((group) => group.displayName)).toEqual(['Building', 'Wrapped up', 'QA']);
    expect(groups[2]?.tickets.map((item) => item.key)).toEqual(['B', 'D']);
  });

  it('matches older snapshots by exact source name', () => {
    expect(groupStandupTickets([ticket('A', 'Done', null, 'done')], entries)[0]).toMatchObject({ displayName: 'Wrapped up', configured: true });
  });

  it('merges new statuses in board order and permits shared display names', () => {
    const draft = mergeStatusDraft('1', 'Board', [{ id: 'todo', name: 'To Do', category: 'new', columnName: 'To Do', boardOrder: 0 }], { boardId: '1', boardName: 'Board', entries });
    expect(draft.entries.map((entry) => entry.statusId)).toEqual(['todo', 'progress', 'done']);
    expect(statusDraftErrors([{ ...entries[0]!, friendlyName: 'Review' }, { ...entries[1]!, friendlyName: 'Review' }]).size).toBe(0);
  });

  it('combines source statuses that share a display name', () => {
    const groups = groupStandupTickets([ticket('A', 'Ready for Review', 'ready'), ticket('B', 'Needs Code Review', 'code')], [
      { statusId: 'ready', sourceName: 'Ready for Review', sourceCategory: 'indeterminate', sourceColumnName: 'Review', friendlyName: 'In review' },
      { statusId: 'code', sourceName: 'Needs Code Review', sourceCategory: 'indeterminate', sourceColumnName: 'Review', friendlyName: 'In review' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ displayName: 'In review' });
    expect(groups[0]?.tickets.map((item) => item.key)).toEqual(['A', 'B']);
  });

  it('derives a restrained group tone from Jira status categories', () => {
    expect(standupTicketGroupTone([ticket('A', 'Done', 'done', 'done')])).toBe('done');
    expect(standupTicketGroupTone([ticket('A', 'To do', 'todo', 'new')])).toBe('new');
    expect(standupTicketGroupTone([ticket('A', 'In progress', 'progress', 'indeterminate')])).toBe('active');
    expect(standupTicketGroupTone([ticket('A', 'To do', 'todo', 'new'), ticket('B', 'Done', 'done', 'done')])).toBe('neutral');
    expect(standupTicketGroupTone([ticket('A', 'Custom', 'custom', 'unknown')])).toBe('neutral');
  });
});
