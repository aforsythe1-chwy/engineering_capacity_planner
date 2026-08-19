import { describe, expect, it } from 'vitest';
import { effectivePlanningDate, localIsoDate } from '../src/lib/planningDate';

describe('planning dates', () => {
  it('formats the browser-local date rather than slicing UTC', () => {
    const fake = { getFullYear: () => 2026, getMonth: () => 0, getDate: () => 2 } as Date;
    expect(localIsoDate(fake)).toBe('2026-01-02');
  });

  it('honors a valid deterministic planning_today setting', () => {
    const dataset = { settings: [{ scope: 'global' as const, scopeId: null, key: 'planning_today', value: '"2028-02-29"' }] };
    expect(effectivePlanningDate(dataset, new Date(2026, 0, 1))).toBe('2028-02-29');
  });

  it('falls back to local today for a malformed setting', () => {
    const dataset = { settings: [{ scope: 'global' as const, scopeId: null, key: 'planning_today', value: '"tomorrow"' }] };
    expect(effectivePlanningDate(dataset, new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
