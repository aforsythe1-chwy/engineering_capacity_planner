/** Deterministic, presentation-only routing for Increment Planner dependencies. */
export type RouteSide = 'top' | 'right' | 'bottom' | 'left';
export type RoutePoint = { x: number; y: number };
export type RouteRect = { id: string; x: number; y: number; width: number; height: number };
export type RouteEdge = { id: string; source: string; target: string; sourceKind?: 'jira' | 'proposed' };
export type RoutedIncrementEdge = {
  edgeId: string;
  sourceSide: RouteSide;
  targetSide: RouteSide;
  points: RoutePoint[];
  labelPoint: RoutePoint;
  fallback?: boolean;
};

export const ROUTE_OPTIONS = {
  clearance: 14,
  leadOut: 18,
  exteriorMargin: 46,
  bendPenalty: 28,
  cornerRadius: 8,
} as const;

type Segment = [RoutePoint, RoutePoint];
type Pair = { sourceSide: RouteSide; targetSide: RouteSide; preference: number };

const sides: Record<RouteSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};

function center(rect: RouteRect, side: RouteSide): RoutePoint {
  if (side === 'top') return { x: rect.x + rect.width / 2, y: rect.y };
  if (side === 'bottom') return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  if (side === 'left') return { x: rect.x, y: rect.y + rect.height / 2 };
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
}

function lead(rect: RouteRect, side: RouteSide, options: typeof ROUTE_OPTIONS): RoutePoint {
  const port = center(rect, side); const vector = sides[side];
  return { x: port.x + vector.x * options.leadOut, y: port.y + vector.y * options.leadOut };
}

function inflate(rect: RouteRect, amount: number): RouteRect {
  return { id: rect.id, x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 };
}

function nearly(a: number, b: number) { return Math.abs(a - b) < 0.001; }
function same(a: RoutePoint, b: RoutePoint) { return nearly(a.x, b.x) && nearly(a.y, b.y); }

function segmentHitsRect([a, b]: Segment, rect: RouteRect): boolean {
  if (nearly(a.x, b.x)) return a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
  if (nearly(a.y, b.y)) return a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  return true;
}

function clean(points: RoutePoint[]): RoutePoint[] {
  const deduped = points.filter((point, index) => index === 0 || !same(point, points[index - 1]!));
  return deduped.filter((point, index, all) => index === 0 || index === all.length - 1 ||
    !((nearly(all[index - 1]!.x, point.x) && nearly(point.x, all[index + 1]!.x)) || (nearly(all[index - 1]!.y, point.y) && nearly(point.y, all[index + 1]!.y))));
}

function pairs(source: RouteRect, target: RouteRect): Pair[] {
  const horizontalOverlap = Math.min(source.x + source.width, target.x + target.width) - Math.max(source.x, target.x);
  const verticalOverlap = Math.min(source.y + source.height, target.y + target.height) - Math.max(source.y, target.y);
  const targetBelow = target.y >= source.y + source.height;
  const targetRight = target.x >= source.x + source.width;
  return ([
    { sourceSide: 'bottom', targetSide: 'top', preference: targetBelow && horizontalOverlap > 0 ? 0 : 180 },
    { sourceSide: 'right', targetSide: 'left', preference: targetRight && verticalOverlap > 0 ? 0 : 180 },
  ] satisfies Pair[]).sort((a, b) => a.preference - b.preference || a.sourceSide.localeCompare(b.sourceSide));
}

function routeBetween(start: RoutePoint, end: RoutePoint, obstacles: RouteRect[], options: typeof ROUTE_OPTIONS): RoutePoint[] | null {
  const minX = Math.min(start.x, end.x, ...obstacles.map((r) => r.x)) - options.exteriorMargin;
  const maxX = Math.max(start.x, end.x, ...obstacles.map((r) => r.x + r.width)) + options.exteriorMargin;
  const minY = Math.min(start.y, end.y, ...obstacles.map((r) => r.y)) - options.exteriorMargin;
  const maxY = Math.max(start.y, end.y, ...obstacles.map((r) => r.y + r.height)) + options.exteriorMargin;
  const xs = [...new Set([start.x, end.x, minX, maxX, ...obstacles.flatMap((r) => [r.x, r.x + r.width])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, minY, maxY, ...obstacles.flatMap((r) => [r.y, r.y + r.height])])].sort((a, b) => a - b);
  const nodes: RoutePoint[] = [];
  for (const x of xs) for (const y of ys) if (!obstacles.some((rect) => x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height)) nodes.push({ x, y });
  const key = (p: RoutePoint) => `${p.x},${p.y}`;
  const byKey = new Map(nodes.map((point) => [key(point), point]));
  const startNode = byKey.get(key(start)); const endNode = byKey.get(key(end));
  if (!startNode || !endNode) return null;
  const best = new Map<string, { cost: number; points: RoutePoint[]; direction?: 'h' | 'v' }>();
  const pending: Array<{ point: RoutePoint; cost: number; points: RoutePoint[]; direction?: 'h' | 'v' }> = [{ point: startNode, cost: 0, points: [startNode] }];
  best.set(`${key(startNode)}:n`, { cost: 0, points: [startNode] });
  while (pending.length) {
    pending.sort((a, b) => a.cost - b.cost || key(a.point).localeCompare(key(b.point)));
    const current = pending.shift()!; const currentKey = `${key(current.point)}:${current.direction ?? 'n'}`;
    if (best.get(currentKey)?.cost !== current.cost) continue;
    if (same(current.point, endNode)) return clean(current.points);
    for (const candidate of nodes) {
      if (same(candidate, current.point) || (!nearly(candidate.x, current.point.x) && !nearly(candidate.y, current.point.y))) continue;
      const segment: Segment = [current.point, candidate];
      if (obstacles.some((rect) => segmentHitsRect(segment, rect))) continue;
      const direction = nearly(candidate.x, current.point.x) ? 'v' : 'h';
      const distance = Math.abs(candidate.x - current.point.x) + Math.abs(candidate.y - current.point.y);
      const cost = current.cost + distance + (current.direction && current.direction !== direction ? options.bendPenalty : 0);
      const candidateKey = `${key(candidate)}:${direction}`;
      if ((best.get(candidateKey)?.cost ?? Infinity) <= cost) continue;
      best.set(candidateKey, { cost, points: [...current.points, candidate], direction });
      pending.push({ point: candidate, cost, points: [...current.points, candidate], direction });
    }
  }
  return null;
}

function labelPoint(points: RoutePoint[]): RoutePoint {
  const segments = points.slice(1).map((point, index) => [points[index]!, point] as Segment);
  const longest = [...segments].sort((a, b) => {
    const al = Math.abs(a[0].x - a[1].x) + Math.abs(a[0].y - a[1].y);
    const bl = Math.abs(b[0].x - b[1].x) + Math.abs(b[0].y - b[1].y);
    return bl - al || (nearly(a[0].y, a[1].y) ? -1 : 1);
  })[0] ?? [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  return { x: (longest[0].x + longest[1].x) / 2, y: (longest[0].y + longest[1].y) / 2 };
}

export function routeIncrementEdges(nodes: RouteRect[], edges: RouteEdge[], overrides: Partial<typeof ROUTE_OPTIONS> = {}): Map<string, RoutedIncrementEdge> {
  const options = { ...ROUTE_OPTIONS, ...overrides };
  const rects = new Map(nodes.map((node) => [node.id, node])); const routes = new Map<string, RoutedIncrementEdge>();
  const ordered = [...edges].sort((a, b) => (a.sourceKind === 'proposed' ? 1 : 0) - (b.sourceKind === 'proposed' ? 1 : 0) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.id.localeCompare(b.id));
  for (const edge of ordered) {
    const source = rects.get(edge.source); const target = rects.get(edge.target);
    if (!source || !target) { console.warn(`[increment-router] Missing endpoint for ${edge.id}`); continue; }
    const obstacles = nodes.filter((node) => node.id !== source.id && node.id !== target.id).map((node) => inflate(node, options.clearance));
    let selected: RoutedIncrementEdge | undefined;
    for (const pair of pairs(source, target)) {
      const sourcePort = center(source, pair.sourceSide); const targetPort = center(target, pair.targetSide);
      const middle = routeBetween(lead(source, pair.sourceSide, options), lead(target, pair.targetSide, options), obstacles, options);
      if (!middle) continue;
      const points = clean([sourcePort, ...middle, targetPort]);
      selected = { edgeId: edge.id, sourceSide: pair.sourceSide, targetSide: pair.targetSide, points, labelPoint: labelPoint(points) };
      break;
    }
    if (!selected) {
      const sourcePort = center(source, 'right'); const targetPort = center(target, 'left');
      const points = clean([sourcePort, { x: sourcePort.x + options.exteriorMargin, y: sourcePort.y }, { x: sourcePort.x + options.exteriorMargin, y: targetPort.y }, targetPort]);
      selected = { edgeId: edge.id, sourceSide: 'right', targetSide: 'left', points, labelPoint: labelPoint(points), fallback: true };
      console.warn(`[increment-router] Exterior fallback for ${edge.id}`);
    }
    routes.set(edge.id, selected);
  }
  return routes;
}

export function routeToSvgPath(points: RoutePoint[], cornerRadius = ROUTE_OPTIONS.cornerRadius): string {
  if (points.length < 2) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!; const previous = points[index - 1]!; const next = points[index + 1];
    if (!next || !cornerRadius) { path += ` L ${point.x} ${point.y}`; continue; }
    const before = Math.min(cornerRadius, (Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)) / 2);
    const after = Math.min(cornerRadius, (Math.abs(next.x - point.x) + Math.abs(next.y - point.y)) / 2);
    const enter = { x: point.x + Math.sign(previous.x - point.x) * before, y: point.y + Math.sign(previous.y - point.y) * before };
    const leave = { x: point.x + Math.sign(next.x - point.x) * after, y: point.y + Math.sign(next.y - point.y) * after };
    path += ` L ${enter.x} ${enter.y} Q ${point.x} ${point.y} ${leave.x} ${leave.y}`;
  }
  return path;
}
