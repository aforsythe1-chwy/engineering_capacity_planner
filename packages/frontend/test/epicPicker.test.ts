import { describe, expect, it } from 'vitest';
import { rankEpicOptions, scoreEpicOption } from '../src/lib/epicPicker';
import { parsePlannerRoute, routeSearch } from '../src/lib/router';

const epics = [
  { key: 'NF-123', title: 'Checkout reliability', health: 'red' as const, targetDate: null, remainingPoints: 13 },
  { key: 'NF-124', title: 'New fulfillment flow', health: 'yellow' as const, targetDate: null, remainingPoints: 8 },
  { key: 'OPS-1', title: 'Platform checkout observability', health: 'green' as const, targetDate: null, remainingPoints: 3 },
];

describe('epic picker matching', () => {
  it('normalizes case, spaces, and hyphens for exact key matches', () => {
    expect(scoreEpicOption(epics[0]!, 'nf 123')).toBe(0);
    expect(rankEpicOptions(epics, 'NF123')[0]!.key).toBe('NF-123');
  });

  it('ranks key matches before title matches deterministically', () => {
    expect(rankEpicOptions(epics, 'nf').map((epic) => epic.key)).toEqual(['NF-123', 'NF-124']);
    expect(rankEpicOptions(epics, 'checkout').map((epic) => epic.key)).toEqual(['NF-123', 'OPS-1']);
  });
});

describe('planner URL state', () => {
  const known = new Set(['NF-123', 'NF-124']);
  it('migrates a legacy singular epic key into plural state', () => {
    expect(parsePlannerRoute('?view=epic&epic=NF-123', known)).toMatchObject({ epics: ['NF-123'], tab: 'timeline', legacy: true });
  });
  it('removes invalid selection without substituting an epic', () => {
    expect(parsePlannerRoute('?view=epic&epics=missing&tab=gantt', known)).toMatchObject({ epics: [], tab: 'gantt', invalidKeys: ['missing'] });
  });
  it('serializes canonical selection and tab state', () => {
    expect(routeSearch({ epics: ['NF-123'], tab: 'dependencies', team: null })).toBe('?tab=dependencies&epics=NF-123');
  });
  it('uses overview as the all-active default and orders selections by dataset order', () => {
    expect(parsePlannerRoute('', known)).toMatchObject({ epics: [], tab: 'overview' });
    expect(parsePlannerRoute('?epics=NF-124,NF-123', known).epics).toEqual(['NF-123', 'NF-124']);
  });
  it('keeps an explicit team scope independent from the Team page and epic filter', () => {
    const teams = new Set(['team-platform']);
    expect(parsePlannerRoute('?tab=team&epics=NF-123&team=team-platform', known, teams)).toMatchObject({
      tab: 'team', epics: ['NF-123'], team: 'team-platform',
    });
    expect(routeSearch({ tab: 'team', epics: [], team: 'team-platform' })).toBe('?tab=team&team=team-platform');
  });
});
