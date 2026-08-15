import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DomainDataset } from '@ecp/shared';
import { projectPortfolioFromDataset } from '@ecp/engine';
import { Configuration } from './components/Configuration';
import { DependencyGraph } from './components/DependencyGraph';
import { EpicPicker } from './components/EpicPicker';
import { GanttBoard } from './components/GanttBoard';
import { JiraRequestDebugToast } from './components/JiraRequestDebugToast';
import { PortfolioOverview } from './components/PortfolioOverview';
import { SyncButton } from './components/SyncButton';
import { loadDataset, type DatasetSource, type RuntimeDataSource } from './data/loadDataset';
import { buildPortfolioOverview } from './lib/portfolioOverview';
import { makeDependencyScope, makeGanttScope } from './lib/plannerPageScopes';
import { buildPlannerScope, type Scenario } from './lib/projection';
import { type PlannerTab, usePlannerRoute } from './lib/router';
import { formatDate } from './lib/format';

function currentIsoDate(): string { return new Date().toISOString().slice(0, 10); }
const tabs: Array<[PlannerTab, string]> = [['overview', 'Overview'], ['timeline', 'Timeline'], ['dependencies', 'Dependencies'], ['gantt', 'Gantt Planner'], ['configuration', 'Configuration']];

export function App() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; dataset: DomainDataset; source: DatasetSource; dataSource: RuntimeDataSource; jiraRequestDebug: boolean }>({ status: 'loading' });
  useEffect(() => { let active = true; loadDataset().then((result) => { if (active) setState({ status: 'ready', ...result }); }); return () => { active = false; }; }, []);
  const reload = useCallback(async () => { const result = await loadDataset(); setState({ status: 'ready', ...result }); }, []);
  if (state.status === 'loading') return <div className="app"><div className="panel" data-testid="loading">Loading capacity plan…</div></div>;
  return <><Planner {...state} onReload={reload} /><JiraRequestDebugToast enabled={state.jiraRequestDebug} /></>;
}

function Planner({ dataset, source, dataSource, onReload }: { dataset: DomainDataset; source: DatasetSource; dataSource: RuntimeDataSource; onReload: () => Promise<void> }) {
  const projection = useMemo(() => projectPortfolioFromDataset(dataset, currentIsoDate()), [dataset]);
  const portfolio = useMemo(() => buildPortfolioOverview(dataset, projection), [dataset, projection]);
  const activeKeys = useMemo(() => new Set(portfolio.pickerOptions.map((epic) => epic.key)), [portfolio]);
  const { route, navigate } = usePlannerRoute(activeKeys);
  const plannerScope = useMemo(() => buildPlannerScope(dataset, route.epics), [dataset, route.epics]);
  const [selection] = useState(() => ({ cutItemKeys: new Set<string>(), doneItemKeys: new Set<string>() }));
  const changeFilter = useCallback((epics: string[]) => navigate({ tab: route.tab, epics: epics.slice(0, 1) }), [navigate, route.tab]);
  const changeTab = useCallback((tab: PlannerTab) => navigate({ tab, epics: route.epics }), [navigate, route.epics]);

  if (dataset.epics.length === 0) return <EmptyLivePlanner dataset={dataset} source={source} dataSource={dataSource} onReload={onReload} />;
  return <AppShell dataset={dataset} source={source} dataSource={dataSource} onReload={onReload} pickerOptions={portfolio.pickerOptions} selectedKeys={route.epics} onSelect={changeFilter} tab={route.tab} onTabChange={changeTab}>
    {route.invalidKeys.length > 0 && <div className="panel config-notice" role="status">{route.invalidKeys.join(', ')} is no longer tracked, so you are viewing all tracked epics.</div>}
    <ScopeSummary selectedKeys={route.epics} activeCount={plannerScope.activeEpics.length} />
    <PlannerPage dataset={dataset} source={source} dataSource={dataSource} onReload={onReload} tab={route.tab} selectedKeys={route.epics} scope={plannerScope} projection={projection} selection={selection} onSelect={changeFilter} />
  </AppShell>;
}

function AppShell({ dataset, source, dataSource, onReload, pickerOptions, selectedKeys, onSelect, tab, onTabChange, children }: { dataset: DomainDataset; source: DatasetSource; dataSource: RuntimeDataSource; onReload: () => Promise<void>; pickerOptions: ReturnType<typeof buildPortfolioOverview>['pickerOptions']; selectedKeys: string[]; onSelect: (keys: string[]) => void; tab: PlannerTab; onTabChange: (tab: PlannerTab) => void; children: ReactNode }) {
  return <div className="app"><header className="app-header app-shell"><div><h1>Engineering Capacity Planner</h1><p className="app-subtitle">Portfolio capacity planning</p></div><div className="shell-controls">{pickerOptions.length > 0 && <EpicPicker epics={pickerOptions} selectedKeys={selectedKeys} selectionMode="single" onSelectionChange={onSelect} label="Epic filter" />}<SyncButton dataset={dataset} source={source} dataSource={dataSource} onReload={onReload} onGoToSetup={() => onTabChange('configuration')} /></div></header><div className="source-note" data-testid="data-source" data-source={source}>{source === 'api' ? dataSource === 'jira' ? '● Live Jira data · Jira sync mode' : dataSource === 'synthetic' ? '● Live backend · synthetic mode' : '● Live backend · data source unavailable' : '○ Bundled sample data (backend not connected)'}</div><nav className="tabs" aria-label="Planner pages">{tabs.map(([value, label]) => <button type="button" key={value} className={`tab${tab === value ? ' active' : ''}`} data-testid={`tab-${value}`} onClick={() => onTabChange(value)}>{label}</button>)}</nav>{children}</div>;
}

function ScopeSummary({ selectedKeys, activeCount }: { selectedKeys: string[]; activeCount: number }) {
  return <p className="scope-summary" role="status">{selectedKeys.length ? `Showing ${selectedKeys.join(', ')}; shared capacity still includes all ${activeCount} active epics.` : `Showing all ${activeCount} active epics.`}</p>;
}

function PlannerPage({ dataset, source, dataSource, onReload, tab, selectedKeys, scope, projection, selection, onSelect }: { dataset: DomainDataset; source: DatasetSource; dataSource: RuntimeDataSource; onReload: () => Promise<void>; tab: PlannerTab; selectedKeys: string[]; scope: ReturnType<typeof buildPlannerScope>; projection: ReturnType<typeof projectPortfolioFromDataset>; selection: { cutItemKeys: Set<string>; doneItemKeys: Set<string> }; onSelect: (keys: string[]) => void }) {
  if (tab === 'overview') return <PortfolioOverview dataset={dataset} selectedKeys={selectedKeys} onSelect={(key) => onSelect([key])} />;
  if (tab === 'timeline') return <PortfolioTimeline dataset={dataset} projection={projection} selectedKeys={selectedKeys} />;
  if (tab === 'configuration') return <Configuration dataset={dataset} teamId={scope.visibleEpics[0]?.teamId ?? dataset.teams[0]?.id ?? null} selectedEpicKeys={selectedKeys} onFilter={onSelect} editable={source === 'api'} dataSource={dataSource} onReload={onReload} />;
  if (tab === 'dependencies') {
    const displayScope = makeDependencyScope(dataset, scope);
    const scenario: Scenario = { today: displayScope.planningToday ?? currentIsoDate(), cutItemKeys: selection.cutItemKeys, doneItemKeys: selection.doneItemKeys, greenMinBufferDays: displayScope.defaults.greenMinBufferDays, oncallMultiplier: displayScope.defaults.oncallMultiplier };
    return <DependencyGraph scope={displayScope} scenario={scenario} />;
  }
  const ganttScope = makeGanttScope(dataset, scope);
  return <><div className="panel gantt-context" role="status">Weekly load and capacity include the full active portfolio. {selectedKeys.length ? 'Only selected epic work is shown below.' : ''}</div><GanttBoard scope={ganttScope} source={source} /></>;
}

function PortfolioTimeline({ dataset, projection, selectedKeys }: { dataset: DomainDataset; projection: ReturnType<typeof projectPortfolioFromDataset>; selectedKeys: string[] }) {
  const results = projection.epics.filter((result) => !selectedKeys.length || selectedKeys.includes(result.epicKey));
  return <main className="portfolio-timeline" data-testid="portfolio-timeline"><section className="panel"><div className="section-title"><h2>Portfolio timeline</h2><span className="hint">Each lane uses the shared portfolio projection; selecting an epic expands its context without granting extra capacity.</span></div>{results.map((result) => { const epic = dataset.epics.find((entry) => entry.key === result.epicKey); const gate = dataset.milestones.find((item) => item.epicKey === result.epicKey && item.isGating); const ongoing = dataset.portfolioEpics?.find((entry) => entry.epicKey === result.epicKey)?.planningKind === 'ongoing'; return <article className={`timeline-lane health-${result.health}`} key={result.epicKey}><strong>{result.epicKey} — {epic?.title}</strong>{ongoing ? <><span>Ongoing capacity work</span><span>{result.reason}</span></> : <><span>Target: {gate ? formatDate(gate.date) : 'Needs target'}</span><span>Projected: {result.projectedDevCompleteDate ? formatDate(result.projectedDevCompleteDate) : 'Not forecast'}</span><span>{result.bufferWorkingDays === null ? result.reason : `${result.bufferWorkingDays} working days buffer`}</span></>}</article>; })}</section></main>;
}


function EmptyLivePlanner({ dataset, source, dataSource, onReload }: { dataset: DomainDataset; source: DatasetSource; dataSource: RuntimeDataSource; onReload: () => Promise<void> }) { return <div className="app"><header className="app-header"><div><h1>Engineering Capacity Planner</h1><div className="epic-title">No capacity plan loaded yet</div></div><SyncButton dataset={dataset} source={source} dataSource={dataSource} onReload={onReload} onGoToSetup={() => undefined} /></header><div className="panel config-notice" data-testid="empty-live-notice">Finish Jira setup below, then sync to import the first capacity plan.</div><Configuration dataset={dataset} teamId={null} selectedEpicKeys={[]} onFilter={() => undefined} editable={source === 'api'} dataSource={dataSource} onReload={onReload} /></div>; }
