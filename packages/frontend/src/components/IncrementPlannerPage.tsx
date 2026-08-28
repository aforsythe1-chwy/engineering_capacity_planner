import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DomainDataset } from '@ecp/shared';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { JiraKeyLink } from './JiraLink';
import {
  arrangeIncrementsBySprint,
  makeSamplePlanner,
  reflowPlanner,
  sampleUnassignedTickets,
  type IncrementNode,
  type PlannerEdge,
  type PlannerNode,
  type PlannerTicket,
  type SprintNode,
  type TicketNode,
} from '../lib/incrementPlannerPrototype';
import { IncrementPlannerEdge } from './IncrementPlannerEdge';
import { routeIncrementEdges } from '../lib/incrementPlannerEdgeRouting';

interface IncrementPlannerPageProps {
  dataset: DomainDataset;
  selectedKeys: string[];
}

type Selection = { kind: 'node' | 'edge'; id: string } | null;
type PlannerSnapshot = { nodes: PlannerNode[]; edges: PlannerEdge[]; unassigned: PlannerTicket[] };

const nodeTypes: NodeTypes = {
  sprint: SprintBandNode,
  increment: IncrementZoneNode,
  ticket: TicketCardNode,
};
const edgeTypes: EdgeTypes = { incrementRoute: IncrementPlannerEdge };

export function IncrementPlannerPage(props: IncrementPlannerPageProps) {
  return <ReactFlowProvider><IncrementPlannerWorkspace {...props} /></ReactFlowProvider>;
}

function IncrementPlannerWorkspace({ dataset, selectedKeys }: IncrementPlannerPageProps) {
  const initial = useMemo(() => makeSamplePlanner(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<PlannerNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<PlannerEdge>(initial.edges);
  const [selection, setSelection] = useState<Selection>(null);
  const [unassigned, setUnassigned] = useState<PlannerTicket[]>(sampleUnassignedTickets);
  const [query, setQuery] = useState('');
  const [isArranging, setIsArranging] = useState(false);
  const [trayOpen, setTrayOpen] = useState(() => localStorage.getItem('ecp.increment-tray-open') !== 'false');
  const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem('ecp.increment-inspector-open') !== 'false');
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<PlannerSnapshot[]>([]);
  const [future, setFuture] = useState<PlannerSnapshot[]>([]);
  const { fitView } = useReactFlow<PlannerNode, PlannerEdge>();

  const routedEdges = useMemo(() => {
    const routes = routeIncrementEdges(
      nodes.filter((node): node is IncrementNode => node.type === 'increment').map((node) => ({
        id: node.id, x: node.position.x, y: node.position.y,
        width: Number(node.style?.width ?? 300), height: Number(node.style?.height ?? 170),
      })),
      edges,
    );
    return edges.map((edge) => {
      const route = routes.get(edge.id);
      return route ? { ...edge, type: 'incrementRoute', sourceHandle: route.sourceSide, targetHandle: route.targetSide, data: { ...edge.data!, route } } : edge;
    });
  }, [edges, nodes]);

  const selectedNode = selection?.kind === 'node' ? nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedEdge = selection?.kind === 'edge' ? edges.find((edge) => edge.id === selection.id) ?? null : null;
  const selectedIncrement = selectedNode?.type === 'increment' ? selectedNode : null;
  const visibleUnassigned = unassigned.filter((item) => `${item.key} ${item.title}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => { localStorage.setItem('ecp.increment-tray-open', String(trayOpen)); }, [trayOpen]);
  useEffect(() => { localStorage.setItem('ecp.increment-inspector-open', String(inspectorOpen)); }, [inspectorOpen]);
  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocused(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focused]);

  const snapshot = useCallback((): PlannerSnapshot => ({ nodes, edges, unassigned }), [nodes, edges, unassigned]);
  const commit = useCallback((apply: (current: PlannerSnapshot) => PlannerSnapshot) => {
    const current = snapshot();
    const next = apply(current);
    setHistory((items) => [...items.slice(-39), current]);
    setFuture([]);
    setNodes(reflowPlanner(next.nodes, next.edges));
    setEdges(next.edges);
    setUnassigned(next.unassigned);
  }, [setEdges, setNodes, snapshot]);

  const resetSample = useCallback(() => {
    const sample = makeSamplePlanner();
    setNodes(sample.nodes);
    setEdges(sample.edges);
    setUnassigned(sampleUnassignedTickets);
    setSelection(null);
    setHistory([]);
    setFuture([]);
  }, [setEdges, setNodes]);

  const addIncrement = useCallback(() => {
    const number = Math.max(0, ...nodes.filter((node): node is IncrementNode => node.type === 'increment').map((node) => node.data.number)) + 1;
    const id = `local-increment-${number}-${Date.now()}`;
    const newNode: IncrementNode = {
      id,
      type: 'increment',
      position: { x: 3190, y: 500 + number * 12 },
      data: {
        number,
        title: 'New increment',
        objective: 'Describe the independently testable outcome for this zone.',
        kind: 'delivery',
        sprint: 'UAT',
        points: 0,
        ticketCount: 0,
      },
      style: { width: 390, height: 220 },
    };
    commit((current) => ({ ...current, nodes: [...current.nodes, newNode] }));
    setSelection({ kind: 'node', id });
  }, [commit, nodes]);

  const addTicket = useCallback((item: PlannerTicket) => {
    if (!selectedIncrement) return;
    const newNode: TicketNode = {
      id: `ticket-${item.key}-${Date.now()}`,
      type: 'ticket',
      position: { x: 0, y: 0 },
      data: { ...item, incrementId: selectedIncrement.id },
      style: { width: 164, height: 80 },
      zIndex: 2,
    };
    commit((current) => ({ ...current, nodes: [...current.nodes, newNode], unassigned: current.unassigned.filter((entry) => entry.key !== item.key) }));
  }, [commit, selectedIncrement]);

  const arrange = useCallback(async () => {
    setIsArranging(true);
    try {
      const next = await arrangeIncrementsBySprint(nodes, edges);
      setNodes(next);
    } finally {
      setIsArranging(false);
    }
  }, [edges, nodes, setNodes]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [snapshot(), ...items].slice(0, 40));
    setNodes(reflowPlanner(previous.nodes, previous.edges)); setEdges(previous.edges); setUnassigned(previous.unassigned);
  }, [history, setEdges, setNodes, snapshot]);
  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1)); setHistory((items) => [...items, snapshot()].slice(-40));
    setNodes(reflowPlanner(next.nodes, next.edges)); setEdges(next.edges); setUnassigned(next.unassigned);
  }, [future, setEdges, setNodes, snapshot]);

  const moveTicket = useCallback((ticketId: string, incrementId: string) => {
    const target = nodes.find((node) => node.id === incrementId && node.type === 'increment');
    if (!target) return;
    commit((current) => ({ ...current, nodes: current.nodes.map((node): PlannerNode => node.id === ticketId && node.type === 'ticket' ? { ...node, data: { ...node.data, incrementId } } : node) }));
    setSelection({ kind: 'node', id: ticketId });
  }, [commit, nodes]);

  const onNodeDragStop = useCallback((_: unknown, node: PlannerNode) => {
    if (node.type === 'ticket') {
      const center = { x: node.position.x + 82, y: node.position.y + 40 };
      const target = nodes.find((candidate): candidate is IncrementNode => candidate.type === 'increment' && center.x >= candidate.position.x && center.x <= candidate.position.x + Number(candidate.style?.width ?? 0) && center.y >= candidate.position.y && center.y <= candidate.position.y + Number(candidate.style?.height ?? 0));
      const currentIncrement = node.data.incrementId as string | undefined;
      if (target && target.id !== currentIncrement) moveTicket(node.id, target.id);
      else setNodes((current) => reflowPlanner(current, edges));
      return;
    }
    if (node.type === 'increment') {
      const centerX = node.position.x + Number(node.style?.width ?? 0) / 2;
      const sprint = nodes.find((candidate): candidate is SprintNode => candidate.type === 'sprint' && centerX >= candidate.position.x && centerX <= candidate.position.x + Number(candidate.style?.width ?? 0));
      if (sprint && sprint.data.label !== node.data.sprint) {
        commit((current) => ({ ...current, nodes: current.nodes.map((candidate): PlannerNode => candidate.id === node.id && candidate.type === 'increment' ? { ...candidate, data: { ...candidate.data, sprint: sprint.data.label } } : candidate) }));
      } else {
        setNodes((current) => reflowPlanner(current, edges));
      }
    }
  }, [commit, edges, moveTicket, nodes, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    const sourceKind = nodes.find((node) => node.id === connection.source)?.type;
    const targetKind = nodes.find((node) => node.id === connection.target)?.type;
    if (sourceKind !== 'increment' || targetKind !== 'increment' || connection.source === connection.target) return;
    setEdges((current) => addEdge<PlannerEdge>({
      ...connection,
      id: `proposed-${connection.source}-${connection.target}-${Date.now()}`,
      type: 'incrementRoute',
      data: { sourceKind: 'proposed' },
      animated: false,
      deletable: true,
      reconnectable: true,
      markerEnd: { type: 'arrowclosed', width: 16, height: 16 },
    }, current));
  }, [nodes, setEdges]);

  const updateIncrement = useCallback((patch: Partial<IncrementNode['data']>) => {
    if (!selectedIncrement) return;
    commit((current) => ({ ...current, nodes: current.nodes.map((node): PlannerNode => {
      if (node.id !== selectedIncrement.id || node.type !== 'increment') return node;
      return { ...node, data: { ...node.data, ...patch } };
    }) }));
  }, [commit, selectedIncrement]);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdge || selectedEdge.data?.sourceKind !== 'proposed') return;
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdge.id));
    setSelection(null);
  }, [selectedEdge, setEdges]);

  const scopeText = selectedKeys.length > 0
    ? `Epic filter: ${selectedKeys.join(', ')}. The PDF sample remains anchored to NF-2771.`
    : `All ${dataset.epics.length} active epics remain in portfolio scope; this sample map is anchored to NF-2771.`;

  return (
    <main className={`increment-planner${focused ? ' is-focused' : ''}`} data-testid="increment-planner">
      <header className="increment-planner-heading">
        <div>
          <p className="eyebrow">Interactive sample workspace</p>
          <div className="increment-planner-title"><h2>Ops Task Manager delivery map</h2><JiraKeyLink jiraKey="NF-2771" /></div>
          <p>Arrange testable increments across sprint capacity. Local moves are semantic and reflow into a stable plan.</p>
        </div>
        <div className="increment-planner-actions">
          <span className="draft-pill">Local prototype · not saved</span>
          <button type="button" className="btn" onClick={undo} disabled={!history.length}>Undo</button>
          <button type="button" className="btn" onClick={redo} disabled={!future.length}>Redo</button>
          <button type="button" className="btn" onClick={arrange} disabled={isArranging}>{isArranging ? 'Reflowing…' : 'Reflow'}</button>
          <button type="button" className="btn" onClick={() => fitView({ padding: .08, maxZoom: .85 })}>Fit plan</button>
          <button type="button" className="btn" onClick={() => setFocused(true)}>Focus canvas</button>
          <button type="button" className="btn primary" onClick={addIncrement}>＋ Add increment</button>
        </div>
      </header>
      <div className="increment-scope-note" role="status">{scopeText} <button type="button" className="link-btn" onClick={resetSample}>Reset local sample</button></div>
      <div className={`increment-planner-grid${trayOpen ? '' : ' tray-collapsed'}${inspectorOpen ? '' : ' inspector-collapsed'}`}>
        {trayOpen && <TicketTray
          tickets={visibleUnassigned}
          query={query}
          onQueryChange={setQuery}
          selectedIncrement={selectedIncrement}
          onAdd={addTicket}
        />}
        <section className="increment-canvas-shell" aria-label="Increment delivery map">
          <div className="increment-canvas-legend" aria-label="Map legend">
            <span><i className="legend-line jira" /> Jira blocker</span>
            <span><i className="legend-line proposed" /> Proposed blocker</span>
            <span>Drop a ticket onto an increment to move it · reflow keeps the board ordered</span>
            <div className="increment-canvas-tools"><button type="button" className="link-btn" onClick={() => setTrayOpen((open) => !open)}>{trayOpen ? 'Hide work tray' : 'Show work tray'}</button><button type="button" className="link-btn" onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? 'Hide inspector' : 'Show inspector'}</button>{focused && <button type="button" className="btn" onClick={() => setFocused(false)}>Exit focus</button>}</div>
          </div>
          <div className="increment-canvas" data-testid="increment-canvas">
            <ReactFlow<PlannerNode, PlannerEdge>
              nodes={nodes}
              edges={routedEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={(oldEdge, newConnection) => setEdges((current) => reconnectEdge(oldEdge, newConnection, current))}
              onNodeClick={(_, node) => {
                setSelection({ kind: 'node', id: node.id });
                if (node.type === 'increment') fitView({ nodes: [{ id: node.id }], padding: 0.18, duration: 280, maxZoom: 1.3 });
              }}
              onEdgeClick={(_, edge) => setSelection({ kind: 'edge', id: edge.id })}
              onPaneClick={() => setSelection(null)}
              onNodeDragStop={onNodeDragStop}
              fitView
              fitViewOptions={{ padding: 0.08, maxZoom: 0.72 }}
              minZoom={0.12}
              maxZoom={1.8}
              nodesConnectable
              edgesReconnectable
              deleteKeyCode={['Backspace', 'Delete']}
              connectionLineStyle={{ stroke: '#e0a63a', strokeWidth: 2 }}
              aria-label="Ops Task Manager increment diagram"
            >
              <Background gap={28} size={1} color="#2b3650" />
              <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(15, 20, 32, .76)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </section>
        {inspectorOpen && <Inspector
          node={selectedNode}
          edge={selectedEdge}
          onUpdateIncrement={updateIncrement}
          onDeleteEdge={deleteSelectedEdge}
          increments={nodes.filter((node): node is IncrementNode => node.type === 'increment')}
          onMoveTicket={moveTicket}
        />}
      </div>
    </main>
  );
}

function TicketTray({ tickets, query, onQueryChange, selectedIncrement, onAdd }: {
  tickets: PlannerTicket[];
  query: string;
  onQueryChange: (value: string) => void;
  selectedIncrement: IncrementNode | null;
  onAdd: (ticket: PlannerTicket) => void;
}) {
  return (
    <aside className="increment-side-panel ticket-tray" aria-label="Unassigned Jira tickets">
      <div className="increment-panel-heading"><div><span>Jira work</span><strong>Unassigned tray</strong></div><span className="count-pill">{tickets.length}</span></div>
      <label className="increment-search"><span>Search tickets</span><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Key or summary" /></label>
      <p className="increment-panel-help">Select a blue, purple, or red zone, then place a ticket. The change stays in this browser session.</p>
      <div className="tray-list">
        {tickets.map((item) => (
          <article className="tray-ticket" key={item.key}>
            <div><JiraKeyLink jiraKey={item.key} />{item.external && <span className="external-pill">Cross-epic</span>}</div>
            <p>{item.title}</p>
            <div><span>{item.points} pts</span><button type="button" className="link-btn" disabled={!selectedIncrement} onClick={() => onAdd(item)}>Place</button></div>
          </article>
        ))}
        {tickets.length === 0 && <p className="empty-tray">No matching unassigned tickets.</p>}
      </div>
    </aside>
  );
}

function Inspector({ node, edge, onUpdateIncrement, onDeleteEdge, increments, onMoveTicket }: {
  node: PlannerNode | null;
  edge: PlannerEdge | null;
  onUpdateIncrement: (patch: Partial<IncrementNode['data']>) => void;
  onDeleteEdge: () => void;
  increments: IncrementNode[];
  onMoveTicket: (ticketId: string, incrementId: string) => void;
}) {
  return (
    <aside className="increment-side-panel increment-inspector" aria-label="Selection inspector">
      <div className="increment-panel-heading"><div><span>Details</span><strong>Inspector</strong></div></div>
      {!node && !edge && <div className="inspector-empty"><strong>Select something on the map</strong><p>Edit a zone, open a ticket in Jira, or inspect where a blocker came from.</p></div>}
      {node?.type === 'increment' && (
        <div className="inspector-form">
          <span className={`zone-kind-pill ${node.data.kind}`}>Increment {node.data.number} · {node.data.kind}</span>
          <label><span>Name</span><input value={node.data.title} onChange={(event) => onUpdateIncrement({ title: event.target.value })} /></label>
          <label><span>Outcome</span><textarea value={node.data.objective} rows={5} onChange={(event) => onUpdateIncrement({ objective: event.target.value })} /></label>
          <dl><div><dt>Sprint</dt><dd>{node.data.sprint}</dd></div><div><dt>Tickets</dt><dd>{node.data.ticketCount}</dd></div><div><dt>Estimate</dt><dd>{node.data.points} pts</dd></div></dl>
          <p className="increment-panel-help">Drag the zone to reschedule visually. Use the side handles to create a proposed blocking relationship.</p>
        </div>
      )}
      {node?.type === 'ticket' && (
        <div className="ticket-inspector">
          <div><JiraKeyLink jiraKey={node.data.key} />{node.data.external && <span className="external-pill">Cross-epic context</span>}</div>
          <h3>{node.data.title}</h3>
          <dl><div><dt>Status</dt><dd>{node.data.status}</dd></div><div><dt>Estimate</dt><dd>{node.data.points} pts</dd></div></dl>
          <label className="increment-move-control"><span>Move to increment</span><select value={(node.data.incrementId as string | undefined) ?? ''} onChange={(event) => onMoveTicket(node.id, event.target.value)}>{increments.map((increment) => <option key={increment.id} value={increment.id}>Increment {increment.data.number}: {increment.data.title}</option>)}</select></label>
          <p className="increment-panel-help">Jira owns the ticket facts. Placement in an increment is local planning intent in this prototype.</p>
        </div>
      )}
      {node?.type === 'sprint' && <div className="inspector-empty"><strong>{node.data.label}</strong><p>{node.data.load} planned points against {node.data.capacity} points of sample capacity.</p></div>}
      {edge && (
        <div className="edge-inspector">
          <span className={`zone-kind-pill ${edge.data?.sourceKind === 'proposed' ? 'critical' : 'delivery'}`}>{edge.data?.sourceKind === 'proposed' ? 'Proposed locally' : 'Imported from Jira'}</span>
          <h3>Blocking relationship</h3>
          <p><code>{edge.source}</code> blocks <code>{edge.target}</code>.</p>
          {edge.data?.sourceKind === 'proposed'
            ? <button type="button" className="btn" onClick={onDeleteEdge}>Delete proposed blocker</button>
            : <p className="increment-panel-help">Imported Jira relationships are read-only in this prototype.</p>}
        </div>
      )}
    </aside>
  );
}

function SprintBandNode({ data }: NodeProps<SprintNode>) {
  const ratio = data.capacity > 0 ? data.load / data.capacity : 0;
  const verdict = ratio > 1 ? 'over' : ratio >= 0.9 ? 'near' : 'available';
  return (
    <div className={`sprint-capacity-node ${verdict}`}>
      <div><span>{data.label}</span><strong>{data.load} / {data.capacity} pts</strong></div>
      <div className="sprint-capacity-track"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
    </div>
  );
}

function IncrementZoneNode({ data, selected }: NodeProps<IncrementNode>) {
  return (
    <div className={`increment-zone-node ${data.kind}`}>
      <NodeResizer isVisible={selected} minWidth={300} minHeight={170} lineClassName="zone-resize-line" handleClassName="zone-resize-handle" />
      <Handle id="left" type="target" position={Position.Left} className="zone-connection-handle" />
      <Handle id="top" type="target" position={Position.Top} className="zone-connection-handle zone-connection-handle-vertical" />
      <div className="increment-zone-header">
        <div><span>Increment {data.number}</span><strong>{data.title}</strong></div>
        <span>{data.points} pts</span>
      </div>
      <p className="increment-zone-objective">{data.objective}</p>
      {data.ticketCount === 0 && <div className="increment-zone-empty">UAT testing buffer</div>}
      <Handle id="right" type="source" position={Position.Right} className="zone-connection-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="zone-connection-handle zone-connection-handle-vertical" />
    </div>
  );
}

function TicketCardNode({ data, selected }: NodeProps<TicketNode>) {
  return (
    <article className={`increment-ticket-node${selected ? ' selected' : ''}`}>
      <div><JiraKeyLink jiraKey={data.key} className="nodrag" />{data.external && <span className="external-pill">External</span>}</div>
      <p>{data.title}</p>
      <footer><span className={`ticket-status ${statusClass(data.status)}`}>{data.status}</span><span>{data.points} pts</span></footer>
    </article>
  );
}

function statusClass(status: PlannerTicket['status']): string {
  if (status === 'Complete') return 'complete';
  if (status === 'In Progress') return 'progress';
  return 'todo';
}

function miniMapColor(node: PlannerNode): string {
  if (node.type === 'sprint') return '#27344a';
  if (node.type === 'ticket') return '#51617e';
  if (node.data.kind === 'critical') return '#8c3c38';
  if (node.data.kind === 'discovery') return '#65407c';
  if (node.data.kind === 'buffer') return '#4b6b2b';
  return '#315d9e';
}
