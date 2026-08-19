import { describe, expect, it } from 'vitest';
import {
  arrangeIncrementsBySprint,
  makeSamplePlanner,
  nextTicketPosition,
} from '../src/lib/incrementPlannerPrototype';
import { parsePlannerRoute, routeSearch } from '../src/lib/router';

describe('Increment Planner prototype', () => {
  it('ships a complete PDF-inspired sample with capacity, zones, tickets, and blockers', () => {
    const sample = makeSamplePlanner();

    expect(sample.nodes.filter((node) => node.type === 'sprint')).toHaveLength(4);
    expect(sample.nodes.filter((node) => node.type === 'increment')).toHaveLength(10);
    expect(sample.nodes.filter((node) => node.type === 'ticket').length).toBeGreaterThan(35);
    expect(sample.edges.length).toBeGreaterThan(10);
    expect(sample.edges.some((edge) => edge.data?.sourceKind === 'proposed')).toBe(true);
    expect(sample.edges.filter((edge) => edge.data?.sourceKind === 'jira').every((edge) => edge.deletable === false)).toBe(true);
  });

  it('places new Jira work inside the selected increment without colliding with the first card', () => {
    const sample = makeSamplePlanner();

    expect(nextTicketPosition(sample.nodes, 'increment-1')).toEqual({ x: 18, y: 268 });
  });

  it('uses ELK to rearrange increment zones while preserving sprint bands and ticket-relative positions', async () => {
    const sample = makeSamplePlanner();
    const sprintBefore = sample.nodes.find((node) => node.id === 'sprint-68')!.position;
    const ticketBefore = sample.nodes.find((node) => node.id === 'ticket-NF-2774')!.position;
    const arranged = await arrangeIncrementsBySprint(sample.nodes, sample.edges);

    expect(arranged.find((node) => node.id === 'sprint-68')!.position).toEqual(sprintBefore);
    expect(arranged.find((node) => node.id === 'ticket-NF-2774')!.position).toEqual(ticketBefore);
    expect(arranged.find((node) => node.id === 'increment-1')!.position.y).toBeGreaterThanOrEqual(120);
  });
});

describe('Increment Planner route', () => {
  it('is a shareable peer page that preserves an epic filter', () => {
    const route = parsePlannerRoute('?tab=increments&epics=NF-2771', new Set(['NF-2771']));

    expect(route).toMatchObject({ tab: 'increments', epics: ['NF-2771'] });
    expect(routeSearch({ tab: route.tab, epics: route.epics, team: null })).toBe('?tab=increments&epics=NF-2771');
  });
});
