import { describe, expect, it } from 'vitest';
import { monthGridDays } from '../src/components/PortfolioMonthCalendar';

describe('monthGridDays', () => {
  it('covers complete weeks around a leap-year February', () => {
    const days = monthGridDays('2028-02-12');
    expect(days[0]).toBe('2028-01-30');
    expect(days.at(-1)).toBe('2028-03-04');
    expect(days).toContain('2028-02-29');
    expect(days.length % 7).toBe(0);
  });

  it('handles year rollover', () => {
    const days = monthGridDays('2026-12-01');
    expect(days[0]).toBe('2026-11-29');
    expect(days.at(-1)).toBe('2027-01-02');
  });
});
