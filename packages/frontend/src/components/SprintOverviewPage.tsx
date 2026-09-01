import { useMemo, useState } from 'react';
import type { DomainDataset, Sprint } from '@ecp/shared';
import { buildCapacityContext, sprintCapacity, type SprintWindow } from '@ecp/engine';
import { Typeahead, type TypeaheadOption } from './Typeahead';

type Props = { dataset: DomainDataset; teamId: string | null; selectedKeys: string[]; mode: 'review' | 'planning'; sprintId: string | null; onRouteChange: (mode: 'review' | 'planning', sprint: string | null) => void; onTeamChange: (teamId: string) => void };
type SprintOption = TypeaheadOption & { sprint: Sprint };

function windowFor(sprint: Sprint, workingDays: number[]): SprintWindow {
  const days: string[] = []; for (let date = new Date(`${sprint.startDate}T00:00:00Z`); date <= new Date(`${sprint.endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) if (workingDays.includes(date.getUTCDay())) days.push(date.toISOString().slice(0, 10));
  return { index: 0, start: sprint.startDate, end: sprint.endDate, workingDays: days };
}

export function SprintOverviewPage({ dataset, teamId, selectedKeys, mode, sprintId, onRouteChange, onTeamChange }: Props) {
  const team = dataset.teams.find((entry) => entry.id === teamId) ?? dataset.teams[0] ?? null;
  const sprints = useMemo(() => dataset.sprints.filter((sprint) => sprint.teamId === team?.id).sort((a, b) => a.startDate.localeCompare(b.startDate)), [dataset.sprints, team?.id]);
  const fallback = mode === 'planning' ? sprints.find((sprint) => sprint.state === 'future') ?? sprints.find((sprint) => sprint.state === 'active') ?? sprints[0] : sprints.find((sprint) => sprint.state === 'active') ?? sprints.at(-1);
  const selected = sprints.find((sprint) => sprint.id === sprintId) ?? fallback ?? null;
  const [query, setQuery] = useState(selected?.name ?? '');
  const options = useMemo<SprintOption[]>(() => sprints.map((sprint) => ({ id: sprint.id, label: sprint.name, hint: `${sprint.startDate} → ${sprint.endDate} · ${sprint.state ?? 'stored'}`, sprint })), [sprints]);
  const capacity = useMemo(() => {
    if (!team || !selected) return null; const members = dataset.members.filter((member) => member.teamId === team.id); const ids = new Set(members.map((member) => member.id));
    return sprintCapacity(windowFor(selected, team.workingDays), buildCapacityContext({ members, pto: dataset.pto.filter((entry) => ids.has(entry.memberId)), oncall: dataset.oncall.filter((entry) => ids.has(entry.memberId)), velocityOverrides: dataset.velocityOverrides.filter((entry) => ids.has(entry.memberId)), holidays: (dataset.holidays ?? []).filter((entry) => entry.teamId === team.id), oncallMultiplier: 0.5 }));
  }, [dataset, selected, team]);
  const open = () => selected && onRouteChange(mode, selected.id);
  if (!team) return <div className="panel">Configure a team before starting Sprint Overview.</div>;
  return <section className="sprint-overview">
    <header className="sprint-overview-header"><div><h2>Sprint Overview</h2><p>Plan the next sprint or review the current outcome. Shared capacity always covers the full tracked portfolio.</p></div>{dataset.teams.length > 1 && <label className="control">Team<select value={team.id} onChange={(event) => onTeamChange(event.target.value)}>{dataset.teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}</header>
    <div className="subtabs" role="tablist" aria-label="Sprint Overview mode"><button className={`subtab${mode === 'review' ? ' active' : ''}`} role="tab" aria-selected={mode === 'review'} onClick={() => onRouteChange('review', selected?.id ?? null)}>Review</button><button className={`subtab${mode === 'planning' ? ' active' : ''}`} role="tab" aria-selected={mode === 'planning'} onClick={() => onRouteChange('planning', selected?.id ?? null)}>Planning</button></div>
    <div className="panel sprint-launch" role="tabpanel"><h3>{mode === 'planning' ? 'Start Sprint Planning' : 'Start Sprint Review'}</h3><p>{mode === 'planning' ? 'Choose a future sprint and assemble a local commitment. This does not update Jira.' : 'Choose a sprint to inspect its current outcome. A planning baseline will be added in the next persistence slice.'}</p><label className="control sprint-picker"><span>Search sprints</span><Typeahead value={query} onChange={setQuery} search={(value) => Promise.resolve(options.filter((option) => option.label.toLowerCase().includes(value.toLowerCase())))} onSelect={(option) => { setQuery(option.label); onRouteChange(mode, option.id); }} selectedId={selected?.id} placeholder="Search sprints" searchAllOnFocus selectValueOnFocus debounceMs={0} showLoading={false} portalMenu /></label><button type="button" className="btn primary" disabled={!selected} onClick={open}>{mode === 'planning' ? 'Start Planning' : 'Start Review'}</button></div>
    {selected && <div className="portfolio-summary sprint-summary"><div className="portfolio-summary-metric"><span>Sprint</span><strong>{selected.name}</strong></div><div className="portfolio-summary-metric"><span>Dates</span><strong>{selected.startDate} → {selected.endDate}</strong></div><div className="portfolio-summary-metric"><span>Adjusted capacity</span><strong>{capacity?.toFixed(1) ?? '—'} pts</strong></div><div className="portfolio-summary-metric"><span>Epic scope</span><strong>{selectedKeys.length ? selectedKeys.join(', ') : 'All active'}</strong></div></div>}
  </section>;
}
