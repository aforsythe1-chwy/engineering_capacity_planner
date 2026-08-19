import { useCallback, useMemo, useState } from 'react';
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
  type Connection,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { JiraKeyLink } from './JiraLink';
import {
  arrangeIncrementsBySprint,
  makeSamplePlanner,
  nextTicketPosition,
  sampleUnassignedTickets,
  type IncrementNode,
  type PlannerEdge,
  type PlannerNode,
  type PlannerTicket,
  type SprintNode,
  type TicketNode,
} from '../lib/incrementPlannerPrototype';

interface IncrementPlannerPageProps {
  dataset: DomainDataset;
  selectedKeys: string[];
}

type Selection = { kind: 'node' | 'edge'; id: string } | null;

const nodeTypes: NodeTypes = {
  sprint: SprintBandNode,
  increment: IncrementZoneNode,
  ticket: TicketCardNode,
};

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

  const selectedNode = selection?.kind === 'node' ? nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedEdge = selection?.kind === 'edge' ? edges.find((edge) => edge.id === selection.id) ?? null : null;
  const selectedIncrement = selectedNode?.type === 'increment' ? selectedNode : null;
  const visibleUnassigned = unassigned.filter((item) => `${item.key} ${item.title}`.toLowerCase().includes(query.toLowerCase()));

  const resetSample = useCallback(() => {
    const sample = makeSamplePlanner();
    setNodes(sample.nodes);
    setEdges(sample.edges);
    setUnassigned(sampleUnassignedTickets);
    setSelection(null);
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
    setNodes((current) => [...current, newNode]);
    setSelection({ kind: 'node', id });
  }, [nodes, setNodes]);

  const addTicket = useCallback((item: PlannerTicket) => {
    if (!selectedIncrement) return;
    const position = nextTicketPosition(nodes, selectedIncrement.id);
    const newNode: TicketNode = {
      id: `ticket-${item.key}-${Date.now()}`,
      type: 'ticket',
      parentId: selectedIncrement.id,
      extent: 'parent',
      expandParent: true,
      position,
      data: item,
      style: { width: 164, height: 80 },
      zIndex: 2,
    };
    setNodes((current) => current.map((node): PlannerNode => {
      if (node.id !== selectedIncrement.id || node.type !== 'increment') return node;
      return { ...node, data: { ...node.data, points: node.data.points + item.points, ticketCount: node.data.ticketCount + 1 } };
    }).concat(newNode));
    setUnassigned((current) => current.filter((entry) => entry.key !== item.key));
  }, [nodes, selectedIncrement, setNodes]);

  const arrange = useCallback(async () => {
    setIsArranging(true);
    try {
      const next = await arrangeIncrementsBySprint(nodes, edges);
      setNodes(next);
    } finally {
      setIsArranging(false);
    }
  }, [edges, nodes, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    const sourceKind = nodes.find((node) => node.id === connection.source)?.type;
    const targetKind = nodes.find((node) => node.id === connection.target)?.type;
    if (sourceKind !== 'increment' || targetKind !== 'increment' || connection.source === connection.target) return;
    setEdges((current) => addEdge<PlannerEdge>({
      ...connection,
      id: `proposed-${connection.source}-${connection.target}-${Date.now()}`,
      type: 'smoothstep',
      label: 'proposed',
      data: { sourceKind: 'proposed' },
      animated: true,
      deletable: true,
      reconnectable: true,
      markerEnd: { type: 'arrowclosed', width: 16, height: 16 },
      style: { stroke: '#e0a63a', strokeDasharray: '7 5', strokeWidth: 2 },
      labelStyle: { fill: '#ffd98a', fontSize: 10 },
      labelBgStyle: { fill: '#181f2e', fillOpacity: 0.94 },
    }, current));
  }, [nodes, setEdges]);

  const updateIncrement = useCallback((patch: Partial<IncrementNode['data']>) => {
    if (!selectedIncrement) return;
    setNodes((current) => current.map((node): PlannerNode => {
      if (node.id !== selectedIncrement.id || node.type !== 'increment') return node;
      return { ...node, data: { ...node.data, ...patch } };
    }));
  }, [selectedIncrement, setNodes]);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdge || selectedEdge.data?.sourceKind !== 'proposed') return;
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdge.id));
    setSelection(null);
  }, [selectedEdge, setEdges]);

  const scopeText = selectedKeys.length > 0
    ? `Epic filter: ${selectedKeys.join(', ')}. The PDF sample remains anchored to NF-2771.`
    : `All ${dataset.epics.length} active epics remain in portfolio scope; this sample map is anchored to NF-2771.`;

  return (
    <main className="increment-planner" data-testid="increment-planner">
      <header className="increment-planner-heading">
        <div>
          <p className="eyebrow">Interactive sample workspace</p>
          <div className="increment-planner-title"><h2>Ops Task Manager delivery map</h2><JiraKeyLink jiraKey="NF-2771" /></div>
          <p>Arrange testable increments across sprint capacity, then draw the relationships that constrain delivery.</p>
        </div>
        <div className="increment-planner-actions">
          <span className="draft-pill">Local prototype · not saved</span>
          <button type="button" className="btn" onClick={resetSample}>Reset sample</button>
          <button type="button" className="btn" onClick={arrange} disabled={isArranging}>{isArranging ? 'Arranging…' : 'Arrange by sprint'}</button>
          <button type="button" className="btn primary" onClick={addIncrement}>＋ Add increment</button>
        </div>
      </header>
      <div className="increment-scope-note" role="status">{scopeText}</div>
      <div className="increment-planner-grid">
        <TicketTray
          tickets={visibleUnassigned}
          query={query}
          onQueryChange={setQuery}
          selectedIncrement={selectedIncrement}
          onAdd={addTicket}
        />
        <section className="increment-canvas-shell" aria-label="Increment delivery map">
          <div className="increment-canvas-legend" aria-label="Map legend">
            <span><i className="legend-line jira" /> Jira blocker</span>
            <span><i className="legend-line proposed" /> Proposed blocker</span>
            <span>Drag zones · connect their side handles · resize from a selected zone</span>
          </div>
          <div className="increment-canvas" data-testid="increment-canvas">
            <ReactFlow<PlannerNode, PlannerEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={(oldEdge, newConnection) => setEdges((current) => reconnectEdge(oldEdge, newConnection, current))}
              onNodeClick={(_, node) => setSelection({ kind: 'node', id: node.id })}
              onEdgeClick={(_, edge) => setSelection({ kind: 'edge', id: edge.id })}
              onPaneClick={() => setSelection(null)}
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
        <Inspector
          node={selectedNode}
          edge={selectedEdge}
          onUpdateIncrement={updateIncrement}
          onDeleteEdge={deleteSelectedEdge}
        />
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

function Inspector({ node, edge, onUpdateIncrement, onDeleteEdge }: {
  node: PlannerNode | null;
  edge: PlannerEdge | null;
  onUpdateIncrement: (patch: Partial<IncrementNode['data']>) => void;
  onDeleteEdge: () => void;
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
      <Handle type="target" position={Position.Left} className="zone-connection-handle" />
      <div className="increment-zone-header">
        <div><span>Increment {data.number}</span><strong>{data.title}</strong></div>
        <span>{data.points} pts</span>
      </div>
      <p className="increment-zone-objective">{data.objective}</p>
      {data.ticketCount === 0 && <div className="increment-zone-empty">UAT testing buffer</div>}
      <Handle type="source" position={Position.Right} className="zone-connection-handle" />
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
