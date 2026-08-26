import { useCallback, useEffect, useRef, useState } from 'react';
import type { DomainDataset, StandupSprintProgressContext } from '@ecp/shared';
import type { PortfolioProjection } from '@ecp/engine';
import * as api from '../data/api';
import { buildPortfolioCalendarModel } from '../lib/portfolioCalendar';
import { PortfolioMonthCalendar } from './PortfolioMonthCalendar';
import { SprintProgressGauge } from './SprintProgressGauge';

export function StandupSprintOpener({ dataset, projection, session }: { dataset: DomainDataset; projection: PortfolioProjection; session: api.StandupAggregate['session'] }) {
  const [context, setContext] = useState<StandupSprintProgressContext | null>(null); const [refreshing, setRefreshing] = useState(false); const requests = useRef(new Map<string, Promise<StandupSprintProgressContext>>());
  const refresh = useCallback(() => { const id = session.id; setRefreshing(true); let request = requests.current.get(id); if (!request) { request = api.refreshStandupSprintProgress(id); requests.current.set(id, request); } void request.then(setContext).catch(() => setContext((current) => current ?? { sprintId: session.sprintId ?? '', sprintName: session.sprintName ?? 'Sprint', startDate: null, endDate: null, capturedAt: new Date().toISOString(), source: 'snapshot', freshness: 'unavailable', items: [], errorMessage: 'Sprint progress unavailable.', truncated: false })).finally(() => { requests.current.delete(id); setRefreshing(false); }); }, [session.id, session.sprintId, session.sprintName]);
  useEffect(() => { let active = true; setContext(null); void api.getStandupSprintProgress(session.id).then((value) => { if (active) setContext(value); }).catch(() => undefined); refresh(); return () => { active = false; }; }, [session.id, refresh]);
  const model = buildPortfolioCalendarModel(dataset, projection, [], session.date);
  return <div className="standup-opener"><div className="standup-opener-progress"><SprintProgressGauge context={context} sessionDate={session.date} refreshing={refreshing} onRetry={refresh} /></div><PortfolioMonthCalendar model={model} heading="Sprint calendar" supportingCopy="Portfolio context for this standup." highlightedSprintId={session.sprintId} /></div>;
}
