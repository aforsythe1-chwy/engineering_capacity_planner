import { describe, expect, it } from 'vitest';
import {
  arrangeIncrementsBySprint,
  makeSamplePlanner,
  nextTicketPosition,
  reflowPlanner,
} from '../src/lib/incrementPlannerPrototype';
import { parsePlannerRoute, routeSearch } from '../src/lib/router';
import { routeIncrementEdges } from '../src/lib/incrementPlannerEdgeRouting';

describe('Increment Planner prototype', () => {
  it('ships a complete PDF-inspired sample with capacity, zones, tickets, and blockers', () => {
    const sample = makeSamplePlanner();

    expect(sample.nodes.filter((node) => node.type === 'sprint')).toHaveLength(4);
    expect(sample.nodes.filter((node) => node.type === 'increment')).toHaveLength(10);
    expect(sample.nodes.filter((node) => node.type === 'ticket').length).toBeGreaterThan(35);
    expect(sample.edges.length).toBeGreaterThan(10);
    expect(sample.edges.some((edge) => edge.data?.sourceKind === 'proposed')).toBe(true);
    expect(sample.edges.filter((edge) => edge.data?.sourceKind === 'jira').every((edge) => edge.deletable === false)).toBe(true);
    const routes = routeIncrementEdges(
      sample.nodes.filter((node): node is import('../src/lib/incrementPlannerPrototype').IncrementNode => node.type === 'increment').map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: Number(node.style?.width), height: Number(node.style?.height) })),
      sample.edges,
    );
    expect(routes.get(sample.edges.find((edge) => edge.source === 'increment-4' && edge.target === 'increment-5')!.id)).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
    const crossSprint = routes.get(sample.edges.find((edge) => edge.source === 'increment-2' && edge.target === 'increment-4')!.id)!;
    expect(crossSprint.points.length).toBeGreaterThan(1);
    expect(crossSprint.points.slice(1).every((point, index) => point.x === crossSprint.points[index]!.x || point.y === crossSprint.points[index]!.y)).toBe(true);
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

  it('derives cards, counts, capacity, and geometry from semantic ticket membership', () => {
    const sample = makeSamplePlanner();
    const moved = sample.nodes.map((node) => node.id === 'ticket-NF-2774' && node.type === 'ticket'
      ? { ...node, position: { x: 9999, y: 9999 }, data: { ...node.data, incrementId: 'increment-2' } }
      : node);
    const reflowed = reflowPlanner(moved, sample.edges);

    const first = reflowed.find((node) => node.id === 'increment-1' && node.type === 'increment')!;
    const second = reflowed.find((node) => node.id === 'increment-2' && node.type === 'increment')!;
    const card = reflowed.find((node) => node.id === 'ticket-NF-2774')!;
    expect(first.data.ticketCount).toBe(3);
    expect(second.data.ticketCount).toBe(12);
    expect(card.position.x).toBeLessThan(1000);
    expect(card.position.y).toBeLessThan(1000);
  });

  it('packs increment containers without overlap inside a sprint lane', () => {
    const sample = makeSamplePlanner();
    const sprint69 = sample.nodes
      .filter((node): node is import('../src/lib/incrementPlannerPrototype').IncrementNode => node.type === 'increment' && node.data.sprint === 'Sprint 69')
      .sort((a, b) => a.position.y - b.position.y);

    for (let index = 1; index < sprint69.length; index += 1) {
      const previous = sprint69[index - 1]!;
      const current = sprint69[index]!;
      expect(current.position.y).toBeGreaterThanOrEqual(previous.position.y + Number(previous.style?.height));
    }
  });
});

describe('Increment Planner route', () => {
  it('is a shareable peer page that preserves an epic filter', () => {
    const route = parsePlannerRoute('?tab=increments&epics=NF-2771', new Set(['NF-2771']));

    expect(route).toMatchObject({ tab: 'increments', epics: ['NF-2771'] });
    expect(routeSearch({ tab: route.tab, epics: route.epics, team: null })).toBe('?tab=increments&epics=NF-2771');
  });
});
