import { addDays, getWeekday, parseIso, type IsoDate, type StandupSession, type StandupStatus } from '@ecp/shared';

export const STANDUP_RECORD_WEEKDAYS = [
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
  { short: 'Sun', long: 'Sunday' },
] as const;

export interface StandupRecordDay {
  date: IsoDate;
  session: StandupSession | null;
}

export interface StandupRecordWeek {
  start: IsoDate;
  end: IsoDate;
  days: readonly [StandupRecordDay, StandupRecordDay, StandupRecordDay, StandupRecordDay, StandupRecordDay, StandupRecordDay, StandupRecordDay];
}

export interface StandupRecordStatusPresentation {
  complete: boolean;
  label: 'Completed' | 'In progress' | 'Needs finishing';
  legendLabel: 'Complete' | 'Incomplete';
}

export function standupRecordStatus(status: StandupStatus): StandupRecordStatusPresentation {
  switch (status) {
    case 'completed': return { complete: true, label: 'Completed', legendLabel: 'Complete' };
    case 'active': return { complete: false, label: 'In progress', legendLabel: 'Incomplete' };
    case 'post_standup': return { complete: false, label: 'Needs finishing', legendLabel: 'Incomplete' };
  }
}

export function groupStandupRecordsByWeek(sessions: readonly StandupSession[]): StandupRecordWeek[] {
  const byDate = new Map<IsoDate, StandupSession>();
  for (const session of sessions) {
    const existing = byDate.get(session.date);
    if (!existing || existing.startedAt < session.startedAt || (existing.startedAt === session.startedAt && existing.id < session.id)) byDate.set(session.date, session);
  }
  const weeks = new Map<IsoDate, StandupSession[]>();
  for (const session of byDate.values()) {
    const start = mondayFor(session.date);
    weeks.set(start, [...(weeks.get(start) ?? []), session]);
  }
  return [...weeks.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([start, weekSessions]) => {
    const byWeekDate = new Map(weekSessions.map((session) => [session.date, session]));
    const day = (offset: number): StandupRecordDay => { const date = addDays(start, offset); return { date, session: byWeekDate.get(date) ?? null }; };
    const days: StandupRecordWeek['days'] = [day(0), day(1), day(2), day(3), day(4), day(5), day(6)];
    return { start, end: addDays(start, 6), days };
  });
}

export function formatStandupRecordWeek(start: IsoDate, end: IsoDate): string {
  const first = parseIso(start); const last = parseIso(end);
  const firstMonth = first.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const lastMonth = last.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const firstYear = first.getUTCFullYear(); const lastYear = last.getUTCFullYear();
  if (firstYear !== lastYear) return `${firstMonth} ${first.getUTCDate()}, ${firstYear}–${lastMonth} ${last.getUTCDate()}, ${lastYear}`;
  if (firstMonth === lastMonth) return `${firstMonth} ${first.getUTCDate()}–${last.getUTCDate()}`;
  return `${firstMonth} ${first.getUTCDate()}–${lastMonth} ${last.getUTCDate()}`;
}

function mondayFor(date: IsoDate): IsoDate {
  const weekday = getWeekday(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}
