import type { WorkItem } from '@ecp/shared';
import { analyzeGraph, type GraphAnalysis, type GraphNodeAnalysis } from '@ecp/engine';
import type { EpicScope, Scenario } from './projection';

/** Leverage banding used to highlight remaining high-value blockers. */
export type LeverageTier = 'high' | 'medium' | 'none';

/** A node's live scenario state, folded in so the graph reflects cuts/done. */
export interface NodeState {
  done: boolean;
  cut: boolean;
}

export interface LayoutNode {
  key: string;
  title: string;
  points: number;
  status: WorkItem['status'];
  layer: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Counts only unfinished, non-cut dependent work. */
  directDependents: number;
  transitiveDependents: number;
  tier: LeverageTier;
  done: boolean;
  cut: boolean;
  focused: boolean;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True when the source has high remaining leverage. */
  fromHighLeverage: boolean;
}

export interface GraphRecommendation {
  key: string;
  title: string;
  directDependents: number;
  transitiveDependents: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** Structural analysis, retained for cycle reporting and graph context. */
  analysis: GraphAnalysis;
  /** Analysis of only unfinished, non-cut work. */
  actionableAnalysis: GraphAnalysis;
  recommendations: GraphRecommendation[];
  doneCount: number;
  visibleCount: number;
  focusKey: string | null;
}

export interface GraphLayoutOptions {
  /** Done work remains explanatory context unless the user hides it. */
  showDone?: boolean;
}

export function subtreeKeys(
  dependencies: readonly { blockerItemKey: string; blockedItemKey: string }[],
  focusKey: string,
): Set<string> {
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const d of dependencies) {
    (downstream.get(d.blockerItemKey) ?? downstream.set(d.blockerItemKey, []).get(d.blockerItemKey)!).push(d.blockedItemKey);
    (upstream.get(d.blockedItemKey) ?? upstream.set(d.blockedItemKey, []).get(d.blockedItemKey)!).push(d.blockerItemKey);
  }
  const keep = new Set<string>([focusKey]);
  const walk = (adj: Map<string, string[]>, start: string): void => {
    const stack = [...(adj.get(start) ?? [])];
    while (stack.length) {
      const node = stack.pop()!;
      if (keep.has(node)) continue;
      keep.add(node);
      stack.push(...(adj.get(node) ?? []));
    }
  };
  walk(downstream, focusKey);
  walk(upstream, focusKey);
  return keep;
}

export const GRAPH_GEOMETRY = { nodeWidth: 168, nodeHeight: 52, colGap: 72, rowGap: 18, padding: 20 } as const;

export function leverageTier(transitiveDependents: number): LeverageTier {
  if (transitiveDependents >= 3) return 'high';
  if (transitiveDependents >= 1) return 'medium';
  return 'none';
}

export function nodeState(item: WorkItem, scenario: Scenario): NodeState {
  return { cut: scenario.cutItemKeys.has(item.key), done: scenario.doneItemKeys.has(item.key) || item.status === 'Done' };
}

/** Whether an item can still be recommended as work to do next. */
export function isActionableItem(item: WorkItem, scenario: Scenario): boolean {
  const state = nodeState(item, scenario);
  return !state.done && !state.cut;
}

function withinLayerOrder(a: GraphNodeAnalysis, b: GraphNodeAnalysis): number {
  return b.transitiveDependents - a.transitiveDependents || b.directDependents - a.directDependents || a.key.localeCompare(b.key, undefined, { numeric: true });
}

function graphEdges(deps: readonly { blockerItemKey: string; blockedItemKey: string }[]) {
  return deps.map((d) => ({ blocker: d.blockerItemKey, blocked: d.blockedItemKey }));
}

/**
 * Builds structural, actionable, and visible views separately. Completion only
 * affects actionable and visible scopes; it never invents a dependency edge.
 */
export function buildGraphLayout(
  scope: EpicScope,
  scenario: Scenario,
  focusKey: string | null = null,
  options: GraphLayoutOptions = {},
): GraphLayout {
  const { nodeWidth, nodeHeight, colGap, rowGap, padding } = GRAPH_GEOMETRY;
  const showDone = options.showDone ?? true;
  const hasFocus = focusKey !== null && scope.workItems.some((w) => w.key === focusKey);
  const keep = hasFocus ? subtreeKeys(scope.dependencies, focusKey!) : null;
  const structuralItems = keep ? scope.workItems.filter((w) => keep.has(w.key)) : scope.workItems;
  const structuralDeps = keep
    ? scope.dependencies.filter((d) => keep.has(d.blockerItemKey) && keep.has(d.blockedItemKey))
    : scope.dependencies;
  const structuralKeys = new Set(structuralItems.map((w) => w.key));
  const analysis = analyzeGraph([...structuralKeys], graphEdges(structuralDeps));

  const actionableItems = structuralItems.filter((item) => isActionableItem(item, scenario));
  const actionableKeys = new Set(actionableItems.map((w) => w.key));
  const actionableDeps = structuralDeps.filter((d) => actionableKeys.has(d.blockerItemKey) && actionableKeys.has(d.blockedItemKey));
  const actionableAnalysis = analyzeGraph([...actionableKeys], graphEdges(actionableDeps));
  const actionableByKey = new Map(actionableAnalysis.nodes.map((node) => [node.key, node]));

  const visibleItems = structuralItems.filter((item) => showDone || !nodeState(item, scenario).done);
  const visibleKeys = new Set(visibleItems.map((w) => w.key));
  const visibleDeps = structuralDeps.filter((d) => visibleKeys.has(d.blockerItemKey) && visibleKeys.has(d.blockedItemKey));
  const visibleAnalysis = analyzeGraph([...visibleKeys], graphEdges(visibleDeps));
  const items = new Map(visibleItems.map((w) => [w.key, w]));

  const columns: GraphNodeAnalysis[][] = Array.from({ length: visibleAnalysis.layerCount }, () => []);
  for (const node of visibleAnalysis.nodes) columns[node.layer]!.push(node);
  for (const column of columns) column.sort((a, b) => {
    const actionableA = actionableByKey.get(a.key) ?? { ...a, directDependents: 0, transitiveDependents: 0 };
    const actionableB = actionableByKey.get(b.key) ?? { ...b, directDependents: 0, transitiveDependents: 0 };
    return withinLayerOrder(actionableA, actionableB);
  });

  const nodes: LayoutNode[] = [];
  const boxByKey = new Map<string, LayoutNode>();
  columns.forEach((column, layer) => column.forEach((node, row) => {
    const item = items.get(node.key)!;
    const state = nodeState(item, scenario);
    const actionable = actionableByKey.get(node.key);
    const transitiveDependents = actionable?.transitiveDependents ?? 0;
    const layout: LayoutNode = {
      key: node.key, title: item.title, points: item.points, status: item.status, layer, row,
      x: padding + layer * (nodeWidth + colGap), y: padding + row * (nodeHeight + rowGap),
      width: nodeWidth, height: nodeHeight,
      directDependents: actionable?.directDependents ?? 0,
      transitiveDependents,
      tier: leverageTier(transitiveDependents),
      focused: hasFocus && node.key === focusKey,
      ...state,
    };
    nodes.push(layout);
    boxByKey.set(node.key, layout);
  }));

  const edges: LayoutEdge[] = [];
  for (const dependency of visibleDeps) {
    const from = boxByKey.get(dependency.blockerItemKey)!;
    const to = boxByKey.get(dependency.blockedItemKey)!;
    edges.push({
      id: `${dependency.blockerItemKey}->${dependency.blockedItemKey}`,
      from: dependency.blockerItemKey, to: dependency.blockedItemKey,
      x1: from.x + from.width, y1: from.y + from.height / 2, x2: to.x, y2: to.y + to.height / 2,
      fromHighLeverage: !from.done && from.tier === 'high',
    });
  }
  const rows = columns.reduce((max, column) => Math.max(max, column.length), 0);
  const width = visibleAnalysis.layerCount === 0 ? 0 : padding * 2 + visibleAnalysis.layerCount * nodeWidth + (visibleAnalysis.layerCount - 1) * colGap;
  const height = rows === 0 ? 0 : padding * 2 + rows * nodeHeight + (rows - 1) * rowGap;
  const recommendations = actionableAnalysis.leaderboard
    .filter((node) => node.transitiveDependents > 0)
    .map((node) => ({ key: node.key, title: structuralItems.find((item) => item.key === node.key)!.title, directDependents: node.directDependents, transitiveDependents: node.transitiveDependents }));

  return { nodes, edges, width, height, analysis, actionableAnalysis, recommendations, doneCount: structuralItems.filter((item) => nodeState(item, scenario).done).length, visibleCount: nodes.length, focusKey: hasFocus ? focusKey : null };
}
