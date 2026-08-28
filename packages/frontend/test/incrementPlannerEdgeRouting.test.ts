import { describe, expect, it } from 'vitest';
import { routeIncrementEdges, routeToSvgPath, type RoutePoint, type RouteRect } from '../src/lib/incrementPlannerEdgeRouting';

const rect = (id: string, x: number, y: number, width = 120, height = 80): RouteRect => ({ id, x, y, width, height });
const orthogonal = (points: RoutePoint[]) => points.slice(1).every((point, index) => point.x === points[index]!.x || point.y === points[index]!.y);
const crosses = (a: RoutePoint, b: RoutePoint, r: RouteRect) => a.x === b.x
  ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
  : a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width;

describe('Increment Planner edge routing', () => {
  it('uses short bottom-to-top routes for vertically aligned neighbors, independent of sprint data', () => {
    const routes = routeIncrementEdges([rect('eight', 0, 0), rect('nine', 0, 180), rect('uat', 0, 360)], [
      { id: 'eight-nine', source: 'eight', target: 'nine', sourceKind: 'jira' },
      { id: 'nine-uat', source: 'nine', target: 'uat', sourceKind: 'proposed' },
    ]);
    for (const id of ['eight-nine', 'nine-uat']) {
      const route = routes.get(id)!;
      expect(route).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
      expect(orthogonal(route.points)).toBe(true);
      expect(route.points.length).toBeLessThanOrEqual(4);
    }
  });

  it('uses right-to-left ports for horizontal neighbors and detours around padded obstacles', () => {
    const blocker = rect('blocker', 160, -20, 110, 120);
    const route = routeIncrementEdges([rect('source', 0, 0), blocker, rect('target', 330, 0)], [{ id: 'edge', source: 'source', target: 'target' }]).get('edge')!;
    expect(route).toMatchObject({ sourceSide: 'right', targetSide: 'left' });
    expect(orthogonal(route.points)).toBe(true);
    expect(route.points.slice(1).some((point, index) => crosses(route.points[index]!, point, { ...blocker, x: blocker.x - 14, y: blocker.y - 14, width: blocker.width + 28, height: blocker.height + 28 }))).toBe(false);
  });

  it('is finite, normalized, deterministic, and emits rounded SVG geometry', () => {
    const nodes = [rect('a', 0, 0), rect('b', 0, 180), rect('c', 180, 80)]; const edges = [{ id: 'a-b', source: 'a', target: 'b' }];
    const first = routeIncrementEdges(nodes, edges).get('a-b')!;
    const second = routeIncrementEdges(nodes, edges).get('a-b')!;
    expect(first).toEqual(second);
    expect(first.points.every((point, index) => Number.isFinite(point.x) && Number.isFinite(point.y) && (index === 0 || point.x !== first.points[index - 1]!.x || point.y !== first.points[index - 1]!.y))).toBe(true);
    expect(routeToSvgPath(first.points)).toContain('M ');
  });

  it('fails safely when an endpoint is missing', () => {
    expect(routeIncrementEdges([rect('a', 0, 0)], [{ id: 'missing', source: 'a', target: 'gone' }]).size).toBe(0);
  });
});
