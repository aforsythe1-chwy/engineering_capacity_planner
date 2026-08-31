import { describe, expect, it } from 'vitest';
import type { StandupSession } from '@ecp/shared';
import { formatStandupRecordWeek, groupStandupRecordsByWeek, standupRecordStatus } from '../src/lib/standupRecords';

const session = (id: string, date: string, status: StandupSession['status'] = 'completed', startedAt = '2026-08-30T09:00:00.000Z'): StandupSession => ({ id, teamId: 'team-1', date, sprintId: null, sprintName: null, status, startedAt, updatedAt: startedAt, completedAt: status === 'completed' ? startedAt : null, revision: 1 });

describe('standup record weeks', () => {
  it('groups unsorted sessions into occupied Monday-first weeks in newest-first order', () => {
    const weeks = groupStandupRecordsByWeek([
      session('tuesday', '2026-09-01', 'active'),
      session('sunday', '2026-08-30'),
      session('monday', '2026-08-24'),
      session('saturday', '2026-08-29', 'post_standup'),
    ]);

    expect(weeks.map((week) => [week.start, week.end])).toEqual([['2026-08-31', '2026-09-06'], ['2026-08-24', '2026-08-30']]);
    expect(weeks[0]!.days.map((day) => day.date)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(weeks[0]!.days[1]!.session?.id).toBe('tuesday');
    expect(weeks[1]!.days[0]!.session?.id).toBe('monday');
    expect(weeks[1]!.days[5]!.session?.id).toBe('saturday');
    expect(weeks[1]!.days[6]!.session?.id).toBe('sunday');
  });

  it('keeps the later started session when malformed input duplicates a date', () => {
    const weeks = groupStandupRecordsByWeek([
      session('earlier', '2026-08-24', 'completed', '2026-08-24T09:00:00.000Z'),
      session('later', '2026-08-24', 'active', '2026-08-24T10:00:00.000Z'),
    ]);
    expect(weeks[0]!.days[0]!.session?.id).toBe('later');
  });

  it('preserves exact status labels while giving unfinished states one compact legend meaning', () => {
    expect(standupRecordStatus('completed')).toEqual({ complete: true, label: 'Completed', legendLabel: 'Complete' });
    expect(standupRecordStatus('active')).toEqual({ complete: false, label: 'In progress', legendLabel: 'Incomplete' });
    expect(standupRecordStatus('post_standup')).toEqual({ complete: false, label: 'Needs finishing', legendLabel: 'Incomplete' });
  });

  it('formats compact ranges across month and year boundaries', () => {
    expect(formatStandupRecordWeek('2026-08-24', '2026-08-30')).toBe('Aug 24–30');
    expect(formatStandupRecordWeek('2026-08-31', '2026-09-06')).toBe('Aug 31–Sep 6');
    expect(formatStandupRecordWeek('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026–Jan 3, 2027');
  });
});
