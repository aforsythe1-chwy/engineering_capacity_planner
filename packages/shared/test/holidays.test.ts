import { describe, expect, it } from 'vitest';
import { describeAnnualHolidayRecurrence, holidayOccurrences } from '../src/holidays.js';
import type { TeamHoliday } from '../src/domain.js';

const laborDay: TeamHoliday = { id: 'labor-day', teamId: 'platform', name: 'Labor Day', recurrence: { kind: 'nth-weekday', month: 9, weekday: 1, ordinal: 1, observedPolicy: 'none' } };

describe('holidayOccurrences', () => {
  it('resolves Labor Day as the first Monday in September every year', () => {
    expect(holidayOccurrences([laborDay], '2026-01-01', '2028-12-31').map((entry) => entry.date)).toEqual(['2026-09-07', '2027-09-06', '2028-09-04']);
  });

  it('supports last weekday rules and fixed-date nearest-weekday observance', () => {
    const memorial: TeamHoliday = { id: 'memorial', teamId: 'platform', name: 'Memorial Day', recurrence: { kind: 'nth-weekday', month: 5, weekday: 1, ordinal: 'last', observedPolicy: 'none' } };
    const independence: TeamHoliday = { id: 'independence', teamId: 'platform', name: 'Independence Day', recurrence: { kind: 'fixed-date', month: 7, day: 4, observedPolicy: 'nearest-weekday' } };
    expect(holidayOccurrences([memorial, independence], '2026-01-01', '2026-12-31')).toMatchObject([{ holidayId: 'memorial', date: '2026-05-25', observed: false }, { holidayId: 'independence', date: '2026-07-03', observed: true }]);
  });

  it('handles leap day and observed dates across a year boundary', () => {
    const leap: TeamHoliday = { id: 'leap', teamId: 'platform', name: 'Leap Day', recurrence: { kind: 'fixed-date', month: 2, day: 29, observedPolicy: 'none' } };
    const newYear: TeamHoliday = { id: 'new-year', teamId: 'platform', name: 'New Year', recurrence: { kind: 'fixed-date', month: 1, day: 1, observedPolicy: 'nearest-weekday' } };
    expect(holidayOccurrences([leap], '2026-01-01', '2030-12-31').map((entry) => entry.date)).toEqual(['2028-02-29']);
    expect(holidayOccurrences([newYear], '2021-12-31', '2021-12-31')).toMatchObject([{ date: '2021-12-31', observed: true }]);
  });

  it('keeps legacy date rows readable until persistence migration', () => {
    const legacy: TeamHoliday = { id: 'legacy', teamId: 'platform', name: 'Legacy shutdown', date: '2026-08-31' };
    expect(holidayOccurrences([legacy], '2026-08-01', '2026-09-01')).toMatchObject([{ date: '2026-08-31', observed: false }]);
  });
});

describe('describeAnnualHolidayRecurrence', () => {
  it('produces a readable Labor Day label', () => {
    expect(describeAnnualHolidayRecurrence(laborDay.recurrence!)).toBe('Every first Monday in September');
  });
});
