import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { ROUTE_OPTIONS, routeToSvgPath, type RoutedIncrementEdge } from '../lib/incrementPlannerEdgeRouting';
import type { PlannerEdge } from '../lib/incrementPlannerPrototype';

export function IncrementPlannerEdge({ data, selected, markerEnd, interactionWidth, sourceX, sourceY, targetX, targetY, ...props }: EdgeProps<PlannerEdge>) {
  const route = data?.route as RoutedIncrementEdge | undefined;
  if (!route) return <BaseEdge {...props} path={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`} markerEnd={markerEnd} interactionWidth={interactionWidth} />;
  const proposed = data?.sourceKind === 'proposed';
  const path = routeToSvgPath(route.points, ROUTE_OPTIONS.cornerRadius);
  const kind = proposed ? 'proposed' : 'jira';
  const relationship = `${props.source} blocks ${props.target}; ${proposed ? 'proposed locally' : 'imported from Jira'}`;
  return <>
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth ?? 22}
      className={`increment-route-edge ${kind}${selected ? ' is-selected' : ''}`}
      aria-label={relationship}
    />
    {selected && <foreignObject x={route.labelPoint.x - 44} y={route.labelPoint.y - 13} width={88} height={26} className="increment-edge-badge-wrap" pointerEvents="none">
      <div className={`increment-edge-badge ${kind}`}>{proposed ? 'Proposed' : 'Jira blocker'}</div>
    </foreignObject>}
  </>;
}
