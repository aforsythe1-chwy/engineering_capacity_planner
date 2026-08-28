import { MarkerType, type Edge, type Node } from '@xyflow/react';

export type IncrementKind = 'delivery' | 'discovery' | 'critical' | 'buffer';

export interface SprintNodeData extends Record<string, unknown> {
  label: string;
  load: number;
  capacity: number;
}

export interface IncrementNodeData extends Record<string, unknown> {
  number: number;
  title: string;
  objective: string;
  kind: IncrementKind;
  sprint: string;
  points: number;
  ticketCount: number;
}

export interface PlannerTicket extends Record<string, unknown> {
  key: string;
  title: string;
  points: number;
  status: 'To Do' | 'In Progress' | 'Complete';
  external?: boolean;
}

export interface TicketNodeData extends Record<string, unknown>, PlannerTicket {}

export interface PlannerEdgeData extends Record<string, unknown> {
  sourceKind: 'jira' | 'proposed';
  route?: import('./incrementPlannerEdgeRouting').RoutedIncrementEdge;
}

export type SprintNode = Node<SprintNodeData, 'sprint'>;
export type IncrementNode = Node<IncrementNodeData, 'increment'>;
export type TicketNode = Node<TicketNodeData, 'ticket'>;
export type PlannerNode = SprintNode | IncrementNode | TicketNode;
export type PlannerEdge = Edge<PlannerEdgeData>;

interface IncrementFixture {
  id: string;
  number: number;
  title: string;
  objective: string;
  kind: IncrementKind;
  sprint: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  columns: number;
  tickets: PlannerTicket[];
}

const ticket = (
  key: string,
  title: string,
  points: number,
  status: PlannerTicket['status'] = 'To Do',
  external = false,
): PlannerTicket => ({ key, title, points, status, external });

const increments: IncrementFixture[] = [
  {
    id: 'increment-1', number: 1, title: 'Login & Page Access', sprint: 'Sprint 68', kind: 'delivery',
    objective: 'Give an operations manager a secure entry point into the new task manager.',
    position: { x: 0, y: 120 }, size: { width: 370, height: 300 }, columns: 2,
    tickets: [
      ticket('NF-2774', 'Log in to the Ops Task Manager UI', 1, 'Complete'),
      ticket('NF-2841', 'Set up Task Manager REST endpoint', 1),
      ticket('NF-2842', 'Set up the Task Manager UI API', 2),
      ticket('NF-2843', 'Set up application shell and route', 1),
    ],
  },
  {
    id: 'increment-2', number: 2, title: 'Discovery & Spikes', sprint: 'Sprint 68', kind: 'discovery',
    objective: 'Resolve the contracts, constraints, and UX questions that unblock delivery.',
    position: { x: 390, y: 120 }, size: { width: 560, height: 515 }, columns: 3,
    tickets: [
      ticket('NF-2806', 'Spike the network health bar', 1, 'Complete'),
      ticket('NF-2844', 'Define task review endpoint contract', 2),
      ticket('NF-2845', 'Determine timeout behavior', 1),
      ticket('NF-2846', 'Validate assignee update limitations', 2),
      ticket('NF-2847', 'Define manager task-list endpoint', 2),
      ticket('NF-2848', 'Prototype the task-review flow', 2),
      ticket('NF-2849', 'Define audit data model', 2),
      ticket('NF-2850', 'Model reassignment confirmation', 2),
      ticket('NF-2851', 'Define table column configuration', 1),
      ticket('NF-2852', 'Define submission payload shape', 1),
      ticket('NF-2853', 'Validate table UX feasibility', 1),
    ],
  },
  {
    id: 'increment-3', number: 3, title: 'Network Health Bar', sprint: 'Sprint 68', kind: 'delivery',
    objective: 'Show current network health before managers act on queued tasks.',
    position: { x: 0, y: 660 }, size: { width: 370, height: 260 }, columns: 2,
    tickets: [
      ticket('NF-2868', 'Expose Task Manager network-health metrics', 3, 'In Progress'),
      ticket('NF-2827', 'Build the network health bar component', 3),
    ],
  },
  {
    id: 'increment-4', number: 4, title: 'CHIRP MUI Setup', sprint: 'Sprint 69', kind: 'delivery',
    objective: 'Create the reusable data-grid foundation. This gate blocks all work to its right.',
    position: { x: 1030, y: 120 }, size: { width: 390, height: 340 }, columns: 2,
    tickets: [
      ticket('NF-2807', 'Add Data Grid to Enterprise CHIRP', 5, 'In Progress'),
      ticket('NF-2839', 'Create advanced data-grid component', 3),
      ticket('NF-2840', 'Create base data-grid component', 3),
    ],
  },
  {
    id: 'increment-5', number: 5, title: 'Task Table Hydration', sprint: 'Sprint 69', kind: 'critical',
    objective: 'Fetch real task data and hydrate the grid with the manager task-list response.',
    position: { x: 1030, y: 490 }, size: { width: 390, height: 400 }, columns: 2,
    tickets: [
      ticket('NF-2817', 'Fetch Ops Task Manager grid data', 3),
      ticket('NF-2818', 'Add the Task Manager table query', 2),
      ticket('NF-2820', 'Map the task-list response', 3),
      ticket('NF-2811', 'Expose the manager task-list endpoint', 5, 'In Progress'),
    ],
  },
  {
    id: 'increment-6', number: 6, title: 'Task Table Foundation', sprint: 'Sprint 69', kind: 'delivery',
    objective: 'Assemble the grid, default views, grouping, metrics, and row behavior.',
    position: { x: 1440, y: 120 }, size: { width: 560, height: 615 }, columns: 3,
    tickets: [
      ticket('NF-2821', 'Define Task Manager grid columns', 3),
      ticket('NF-2814', 'Configure data-row grouping', 2),
      ticket('NF-2815', 'Configure default task views', 3),
      ticket('NF-2837', 'Configure row actions', 2),
      ticket('NF-2838', 'Configure grid footer', 2),
      ticket('NF-2813', 'Add network metrics query', 3),
      ticket('NF-2863', 'Add the grid toolbar', 2),
      ticket('NF-2864', 'Add empty and loading states', 2),
      ticket('NF-2865', 'Wire task selection state', 2),
    ],
  },
  {
    id: 'increment-7', number: 7, title: 'Search, Filter & Navigation', sprint: 'Sprint 70', kind: 'delivery',
    objective: 'Help managers find the right tasks and move through the table quickly.',
    position: { x: 2080, y: 525 }, size: { width: 420, height: 380 }, columns: 2,
    tickets: [
      ticket('NF-2810', 'Add table sorting', 2),
      ticket('NF-2829', 'Configure Task Manager filtering', 2),
      ticket('NF-2830', 'Map the metrics view', 2),
      ticket('NF-2831', 'Persist view preferences', 2),
    ],
  },
  {
    id: 'increment-8', number: 8, title: 'Task Reassignment', sprint: 'Sprint 70', kind: 'delivery',
    objective: 'Let a manager reassign one or many tasks safely from the table.',
    position: { x: 2080, y: 120 }, size: { width: 590, height: 380 }, columns: 3,
    tickets: [
      ticket('NF-2854', 'Add assign-task endpoint', 3),
      ticket('NF-2855', 'Update task assignment', 3),
      ticket('NF-2856', 'Add reassignment row action', 2),
      ticket('NF-2857', 'Assign multiple tasks', 3),
      ticket('NF-2858', 'Confirm batch reassignment', 2),
      ticket('NF-2859', 'Queue reassignment events', 3),
    ],
  },
  {
    id: 'increment-9', number: 9, title: 'Assignment Logic & Audit', sprint: 'Sprint 70', kind: 'discovery',
    objective: 'Finish assignment policy, audit history, release limits, and timed reassignment.',
    position: { x: 2690, y: 120 }, size: { width: 420, height: 555 }, columns: 2,
    tickets: [
      ticket('NF-2835', 'Build reassignment confirmation modal', 2),
      ticket('NF-2836', 'Write the reassignment model', 3),
      ticket('NF-2823', 'Align AD values for assignment pool', 2),
      ticket('NF-2824', 'Add and remove assignment pool', 3),
      ticket('NF-2825', 'Implement release maximum limit', 2),
      ticket('NF-2826', 'Implement 12-hour automatic reassignment', 4),
    ],
  },
  {
    id: 'increment-10', number: 10, title: 'UAT Testing', sprint: 'UAT', kind: 'buffer',
    objective: 'Protected user-acceptance testing buffer before the epic is considered done.',
    position: { x: 3190, y: 270 }, size: { width: 390, height: 180 }, columns: 1,
    tickets: [],
  },
];

const sprintColumns = [
  { label: 'Sprint 68', x: 0, width: 950, load: 26, capacity: 37.5 },
  { label: 'Sprint 69', x: 1030, width: 970, load: 36, capacity: 37.5 },
  { label: 'Sprint 70', x: 2080, width: 1030, load: 38, capacity: 37.5 },
  { label: 'UAT', x: 3190, width: 390, load: 0, capacity: 37.5 },
] as const;

export const sampleUnassignedTickets: PlannerTicket[] = [
  ticket('NF-2772', 'Confirm final acceptance criteria', 2),
  ticket('NF-2776', 'Add operational telemetry', 3),
  ticket('NF-2780', 'Document manager workflow', 2),
  ticket('NF-2940', 'Add CPC assignment endpoint', 3, 'To Do', true),
];

function sprintNodes(): SprintNode[] {
  return sprintColumns.map((sprint, index) => ({
    id: `sprint-${index + 68}`,
    type: 'sprint',
    position: { x: sprint.x, y: 0 },
    data: { label: sprint.label, load: sprint.load, capacity: sprint.capacity },
    style: { width: sprint.width, height: 80 },
    draggable: false,
    selectable: false,
    deletable: false,
    zIndex: -1,
  }));
}

function incrementNode(fixture: IncrementFixture): IncrementNode {
  return {
    id: fixture.id,
    type: 'increment',
    position: fixture.position,
    data: {
      number: fixture.number,
      title: fixture.title,
      objective: fixture.objective,
      kind: fixture.kind,
      sprint: fixture.sprint,
      points: fixture.tickets.reduce((sum, item) => sum + item.points, 0),
      ticketCount: fixture.tickets.length,
    },
    style: fixture.size,
    zIndex: 0,
  };
}

function ticketNodes(fixture: IncrementFixture): TicketNode[] {
  return fixture.tickets.map((item) => ({
    id: `ticket-${item.key}`,
    type: 'ticket',
    // Membership is semantic. Cards are rendered in absolute canvas space so a
    // drag can be interpreted as a move command instead of a persisted offset.
    position: { x: 0, y: 0 },
    data: { ...item, incrementId: fixture.id },
    style: { width: 164, height: 80 },
    zIndex: 2,
  }));
}

const blockerPairs: Array<[string, string, PlannerEdgeData['sourceKind']]> = [
  ['increment-1', 'increment-2', 'jira'],
  ['increment-2', 'increment-3', 'jira'],
  ['increment-2', 'increment-4', 'jira'],
  ['increment-3', 'increment-6', 'jira'],
  ['increment-4', 'increment-5', 'jira'],
  ['increment-4', 'increment-6', 'jira'],
  ['increment-5', 'increment-6', 'jira'],
  ['increment-5', 'increment-8', 'jira'],
  ['increment-6', 'increment-7', 'jira'],
  ['increment-6', 'increment-8', 'jira'],
  ['increment-8', 'increment-9', 'jira'],
  ['increment-9', 'increment-10', 'proposed'],
];

export function makeSamplePlanner(): { nodes: PlannerNode[]; edges: PlannerEdge[] } {
  const nodes: PlannerNode[] = [...sprintNodes()];
  for (const fixture of increments) nodes.push(incrementNode(fixture));
  for (const fixture of increments) nodes.push(...ticketNodes(fixture));
  const edges = blockerPairs.map(([source, target, sourceKind], index): PlannerEdge => ({
    id: `blocker-${index + 1}`,
    source,
    target,
    type: 'incrementRoute',
    data: { sourceKind },
    animated: false,
    deletable: sourceKind === 'proposed',
    reconnectable: sourceKind === 'proposed',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  }));
  return { nodes: reflowPlanner(nodes, edges), edges };
}

export function nextTicketPosition(nodes: PlannerNode[], parentId: string): { x: number; y: number } {
  const count = nodes.filter((node) => node.type === 'ticket' && ticketIncrementId(node) === parentId).length;
  return { x: 18 + (count % 2) * 178, y: 76 + Math.floor(count / 2) * 96 };
}

const CARD_WIDTH = 164;
const CARD_HEIGHT = 80;
const CARD_GAP = 14;
const CARD_INSET = 18;
const HEADER_HEIGHT = 76;

function ticketIncrementId(node: TicketNode): string | undefined {
  return (node.data.incrementId as string | undefined) ?? node.parentId;
}

/**
 * Rebuilds presentation geometry from planner meaning. This deliberately
 * discards prior x/y and container dimensions: membership, sprint and order
 * are the only inputs that survive a layout pass.
 */
export function reflowPlanner(nodes: PlannerNode[], edges: PlannerEdge[]): PlannerNode[] {
  const incrementsById = new Map(nodes.filter((node): node is IncrementNode => node.type === 'increment').map((node) => [node.id, node]));
  const ticketsByIncrement = new Map<string, TicketNode[]>();
  for (const node of nodes) {
    if (node.type !== 'ticket') continue;
    const incrementId = ticketIncrementId(node);
    if (!incrementId || !incrementsById.has(incrementId)) continue;
    const items = ticketsByIncrement.get(incrementId) ?? [];
    items.push(node);
    ticketsByIncrement.set(incrementId, items);
  }

  const orderedSprints = [...sprintColumns.map((column) => column.label), ...[...incrementsById.values()].map((node) => node.data.sprint)]
    .filter((sprint, index, values) => values.indexOf(sprint) === index);
  let nextX = 0;
  const lane = new Map<string, { x: number; width: number; load: number; capacity: number }>();
  for (const sprint of orderedSprints) {
    const items = [...incrementsById.values()].filter((node) => node.data.sprint === sprint);
    const width = sprint === 'UAT' ? 390 : Math.max(620, Math.min(980, Math.max(1, items.length) * 410));
    const load = items.reduce((sum, node) => sum + (ticketsByIncrement.get(node.id) ?? []).reduce((points, ticket) => points + ticket.data.points, 0), 0);
    lane.set(sprint, { x: nextX, width, load, capacity: 37.5 });
    nextX += width + 80;
  }

  const dependencyRank = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (incrementsById.has(edge.source) && incrementsById.has(edge.target)) {
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    }
  }
  const rank = (id: string, path = new Set<string>()): number => {
    if (dependencyRank.has(id)) return dependencyRank.get(id)!;
    if (path.has(id)) return 0; // cycles remain visible; they do not make layout unstable.
    const nextPath = new Set(path); nextPath.add(id);
    const value = Math.max(0, ...(incoming.get(id) ?? []).map((source) => rank(source, nextPath) + 1));
    dependencyRank.set(id, value);
    return value;
  };
  for (const id of incrementsById.keys()) rank(id);

  const positioned = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const sprint of orderedSprints) {
    const spec = lane.get(sprint)!;
    const items = [...incrementsById.values()]
      .filter((node) => node.data.sprint === sprint)
      .sort((a, b) => rank(a.id) - rank(b.id) || a.data.number - b.data.number || a.id.localeCompare(b.id));
    // Rank establishes deterministic dependency-aware order. A sprint lane is
    // then packed vertically as a single flow so rank changes can never make
    // independently sized increment containers overlap.
    let nextY = 120;
    for (const increment of items) {
      const ticketCount = (ticketsByIncrement.get(increment.id) ?? []).length;
      const columns = Math.max(1, Math.min(3, Math.floor((Math.min(spec.width - CARD_INSET * 2, 560) + CARD_GAP) / (CARD_WIDTH + CARD_GAP))));
      const width = Math.max(300, columns * CARD_WIDTH + (columns - 1) * CARD_GAP + CARD_INSET * 2);
      const height = Math.max(170, HEADER_HEIGHT + Math.ceil(ticketCount / columns) * (CARD_HEIGHT + CARD_GAP) + CARD_INSET);
      positioned.set(increment.id, { x: spec.x + Math.max(16, (spec.width - width) / 2), y: nextY, width, height });
      nextY += height + 58;
    }
  }

  return nodes.map((node): PlannerNode => {
    if (node.type === 'sprint') {
      const spec = lane.get(node.data.label);
      return spec ? { ...node, position: { x: spec.x, y: 0 }, data: { ...node.data, load: spec.load, capacity: spec.capacity }, style: { width: spec.width, height: 80 } } : node;
    }
    if (node.type === 'increment') {
      const geometry = positioned.get(node.id)!;
      const tickets = ticketsByIncrement.get(node.id) ?? [];
      return { ...node, position: { x: geometry.x, y: geometry.y }, data: { ...node.data, points: tickets.reduce((sum, ticket) => sum + ticket.data.points, 0), ticketCount: tickets.length }, style: { width: geometry.width, height: geometry.height } };
    }
    const incrementId = ticketIncrementId(node);
    const parent = incrementId ? positioned.get(incrementId) : undefined;
    const siblings = incrementId ? ticketsByIncrement.get(incrementId) ?? [] : [];
    const index = siblings.findIndex((ticket) => ticket.id === node.id);
    if (!parent || index < 0) return { ...node, parentId: undefined, extent: undefined, expandParent: undefined };
    const columns = Math.max(1, Math.floor((parent.width - CARD_INSET * 2 + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));
    return { ...node, parentId: undefined, extent: undefined, expandParent: undefined, position: { x: parent.x + CARD_INSET + (index % columns) * (CARD_WIDTH + CARD_GAP), y: parent.y + HEADER_HEIGHT + Math.floor(index / columns) * (CARD_HEIGHT + CARD_GAP) }, data: { ...node.data, incrementId }, style: { width: CARD_WIDTH, height: CARD_HEIGHT } };
  });
}

/** Backward-compatible name used by the prototype's existing controls. */
export async function arrangeIncrementsBySprint(nodes: PlannerNode[], edges: PlannerEdge[]): Promise<PlannerNode[]> {
  return reflowPlanner(nodes, edges);
}
