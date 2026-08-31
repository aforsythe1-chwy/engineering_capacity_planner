import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BandwidthCheckIn, BandwidthDay, BandwidthFeeling, DomainDataset } from '@ecp/shared';
import * as api from '../data/api';
import { buildAvailabilityEntries, type AvailabilityEntry, type AvailabilityKind } from '../lib/availability';
import { fuzzyScore } from '../lib/fuzzySearch';
import { memberColorMap } from '../lib/memberColors';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { AvailabilityList } from './AvailabilityList';
import { AddAvailabilityModal, type NewAvailability } from './AddAvailabilityModal';
import { BandwidthDayEditor } from './BandwidthDayEditor';
import { EngineerSprintOutput } from './EngineerSprintOutput';
import { Typeahead, type TypeaheadOption } from './Typeahead';

type TeamView = 'bandwidth' | 'availability' | 'sprint-output';
const teamViews: Array<{ value: TeamView; label: string }> = [
  { value: 'bandwidth', label: 'Bandwidth' },
  { value: 'availability', label: 'Availability' },
  { value: 'sprint-output', label: 'Sprint output' },
];
const feelings: Array<{ value: BandwidthFeeling; label: string; description: string }> = [
  { value: 'red', label: 'Red', description: 'Drowning' },
  { value: 'yellow', label: 'Yellow', description: "Things are getting overloaded, but I'm managing" },
  { value: 'green', label: 'Green', description: "I'd be happy if I had this amount of work all the time" },
  { value: 'purple', label: 'Purple', description: "I don't have enough work to do" },
];

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;
const addMonths = (month: string, amount: number) => {
  const date = new Date(`${month}T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
};
const monthEnd = (month: string) => {
  const date = new Date(`${month}T12:00:00`);
  date.setMonth(date.getMonth() + 1, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const monthLabel = (month: string) => new Date(`${month}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function monthDays(month: string): string[] {
  const end = Number(monthEnd(month).slice(-2));
  return Array.from({ length: end }, (_, index) => `${month.slice(0, 8)}${String(index + 1).padStart(2, '0')}`);
}

export function TeamPage({ dataset, teamId, editable, onReload, onTeamChange }: {
  dataset: DomainDataset;
  teamId: string | null;
  editable: boolean;
  onReload: () => Promise<void>;
  onTeamChange: (teamId: string) => void;
}) {
  const [view, setView] = useState<TeamView>('bandwidth');
  const [month, setMonth] = useState(monthOf(localToday()));
  const [memberId, setMemberId] = useState('');
  const [checkIns, setCheckIns] = useState<BandwidthCheckIn[]>(dataset.bandwidthCheckIns ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityView, setAvailabilityView] = useState<'calendar' | 'list'>('calendar');
  const [addingAvailability, setAddingAvailability] = useState(false);
  const [selectedBandwidthDate, setSelectedBandwidthDate] = useState<string | null>(null);
  const bandwidthTriggerRef = useRef<HTMLButtonElement | null>(null);
  const team = dataset.teams.find((candidate) => candidate.id === teamId) ?? dataset.teams[0] ?? null;
  const members = useMemo(() => team ? dataset.members.filter((member) => member.teamId === team.id) : [], [dataset.members, team]);
  const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);
  const validMemberId = memberId && activeMembers.some((member) => member.id === memberId) ? memberId : '';
  const visibleMembers = validMemberId ? members.filter((member) => member.id === validMemberId) : members;
  const visibleCheckIns = useMemo(() => validMemberId ? checkIns.filter((checkIn) => checkIn.memberId === validMemberId) : checkIns, [checkIns, validMemberId]);
  const colors = useMemo(() => memberColorMap(members), [members]);

  useEffect(() => {
    if (memberId !== validMemberId) setMemberId(validMemberId);
  }, [memberId, validMemberId]);

  useEffect(() => {
    if (!team) return;
    if (!editable) { setCheckIns(dataset.bandwidthCheckIns ?? []); return; }
    setLoading(true); setError(null);
    api.listBandwidthCheckIns(team.id, month, monthEnd(month))
      .then((result) => setCheckIns(result.checkIns))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [dataset.bandwidthCheckIns, editable, month, team]);

  const availabilityEntries = useMemo(() => buildAvailabilityEntries(dataset, visibleMembers, colors)
    .filter((entry) => entry.startDate <= monthEnd(month) && entry.endDate >= month), [colors, dataset, month, visibleMembers]);
  const deleteAvailability = async (entry: AvailabilityEntry) => {
    const action = entry.kind === 'pto' ? api.deletePto : entry.kind === 'oncall' ? api.deleteOncall : api.deleteVelocityOverride;
    try { await action(entry.id); await onReload(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const addAvailability = async (kind: AvailabilityKind, input: NewAvailability) => {
    if (kind === 'pto') await api.createPto(input);
    else if (kind === 'oncall') await api.createOncall(input);
    else await api.createVelocityOverride({ ...input, multiplier: input.multiplier ?? 1 });
    await onReload();
  };
  const closeBandwidthEditor = () => {
    setSelectedBandwidthDate(null);
    requestAnimationFrame(() => bandwidthTriggerRef.current?.focus());
  };
  const saveBandwidthDay = (day: BandwidthDay) => {
    setCheckIns((items) => [...items.filter((item) => item.date !== day.date), ...day.checkIns]);
  };

  useEffect(() => { setSelectedBandwidthDate(null); }, [month, team?.id]);

  if (!team) return <main className="team-page"><section className="panel">No team is configured yet.</section></main>;
  return <main className="team-page" data-testid="team-page">
    <TeamWorkspaceHeading teams={dataset.teams} teamId={team.id} onTeamChange={onTeamChange} />
    <TeamAnalysisTabs value={view} onChange={setView} />
    <TeamScopeToolbar members={activeMembers} value={validMemberId} onChange={setMemberId} />
    {error && <div className="panel config-error" role="alert">⚠ {error}</div>}
    <section className="team-analysis-panel" role="tabpanel" id={`team-analysis-panel-${view}`} aria-labelledby={`team-analysis-tab-${view}`}>
      {view === 'bandwidth'
      ? <><BandwidthView checkIns={visibleCheckIns} month={month} setMonth={setMonth} loading={loading} onSelectDate={(date, trigger) => { bandwidthTriggerRef.current = trigger; setSelectedBandwidthDate(date); }} />
        {selectedBandwidthDate && <BandwidthDayEditor teamId={team.id} date={selectedBandwidthDate} members={members} editable={editable} initialCheckIns={checkIns.filter((entry) => entry.date === selectedBandwidthDate)} colors={colors} onClose={closeBandwidthEditor} onSaved={saveBandwidthDay} />}
      </>
      : view === 'sprint-output' ? <EngineerSprintOutput teamId={team.id} members={activeMembers} selectedMemberId={validMemberId} colors={colors} connected={editable} /> : <TeamAvailabilityPanel month={month} onMonthChange={setMonth} view={availabilityView} onViewChange={setAvailabilityView} entries={availabilityEntries} editable={editable} onDelete={deleteAvailability} members={activeMembers} adding={addingAvailability} onStartAdd={() => setAddingAvailability(true)} onCloseAdd={() => setAddingAvailability(false)} onAdd={addAvailability} />}
    </section>
  </main>;
}

function TeamWorkspaceHeading({ teams, teamId, onTeamChange }: { teams: DomainDataset['teams']; teamId: string; onTeamChange: (teamId: string) => void }) {
  return <section className="team-workspace-heading">
    <div><h2>Team</h2><p className="hint">Calendar analysis for team-owned signals. Epic filters do not change this view.</p></div>
    {teams.length > 1 && <label className="control team-selector"><span>Team</span><select value={teamId} onChange={(event) => onTeamChange(event.target.value)}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
  </section>;
}

function TeamAnalysisTabs({ value, onChange }: { value: TeamView; onChange: (view: TeamView) => void }) {
  const activate = (next: TeamView) => { onChange(next); requestAnimationFrame(() => document.getElementById(`team-analysis-tab-${next}`)?.focus()); };
  return <div className="subtabs team-analysis-tabs" role="tablist" aria-label="Team analysis">
    {teamViews.map(({ value: item, label }, index) => <button key={item} id={`team-analysis-tab-${item}`} type="button" role="tab" aria-selected={value === item} aria-controls={`team-analysis-panel-${item}`} tabIndex={value === item ? 0 : -1} className={`subtab${value === item ? ' active' : ''}`} onClick={() => onChange(item)} onKeyDown={(event) => {
      const move = (nextIndex: number) => activate(teamViews[(nextIndex + teamViews.length) % teamViews.length]!.value);
      if (event.key === 'ArrowRight') { event.preventDefault(); move(index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); move(index - 1); }
      else if (event.key === 'Home') { event.preventDefault(); move(0); }
      else if (event.key === 'End') { event.preventDefault(); move(teamViews.length - 1); }
    }}>{label}</button>)}
  </div>;
}

function TeamScopeToolbar({ members, value, onChange }: { members: DomainDataset['members']; value: string; onChange: (memberId: string) => void }) {
  return <section className="team-scope-toolbar" aria-label="Team analysis scope"><TeamMemberPicker members={members} value={value} onChange={onChange} /></section>;
}

const allEngineersOption = { id: 'all-engineers', label: 'All engineers' } satisfies TypeaheadOption;

function TeamMemberPicker({ members, value, onChange }: { members: DomainDataset['members']; value: string; onChange: (memberId: string) => void }) {
  const options = useMemo(() => [allEngineersOption, ...members.slice().sort((a, b) => a.name.localeCompare(b.name)).map((member) => ({ id: member.id, label: member.name, imageUrl: member.avatarUrl }))], [members]);
  const selectedLabel = options.find((option) => option.id === (value || allEngineersOption.id))?.label ?? allEngineersOption.label;
  const [inputValue, setInputValue] = useState(selectedLabel);
  const committedValue = useRef(value);
  const search = useCallback(async (query: string) => {
    const rankedMembers = options.slice(1).map((option) => ({ option, score: fuzzyScore(option.label, query) })).filter((entry) => entry.score !== null).sort((a, b) => a.score! - b.score! || a.option.label.localeCompare(b.option.label)).map(({ option }) => option);
    return [allEngineersOption, ...rankedMembers];
  }, [options]);

  useEffect(() => {
    if (committedValue.current !== value) { committedValue.current = value; setInputValue(selectedLabel); }
  }, [selectedLabel, value]);

  return <label className="control team-member-picker"><span>Engineer</span><Typeahead value={inputValue} inputType="search" placeholder="Search engineers" selectedId={value || allEngineersOption.id} search={search} searchOnEmpty searchAllOnFocus selectValueOnFocus debounceMs={0} showLoading={false} onChange={(next) => { committedValue.current = ''; setInputValue(next); onChange(''); }} onSelect={(option) => { const memberId = option.id === allEngineersOption.id ? '' : option.id; committedValue.current = memberId; setInputValue(option.label); onChange(memberId); }} onDismiss={() => setInputValue(selectedLabel)} /></label>;
}

function TeamAvailabilityPanel({ month, onMonthChange, view, onViewChange, entries, editable, onDelete, members, adding, onStartAdd, onCloseAdd, onAdd }: {
  month: string; onMonthChange: (month: string) => void; view: 'calendar' | 'list'; onViewChange: (view: 'calendar' | 'list') => void; entries: AvailabilityEntry[]; editable: boolean; onDelete: (entry: AvailabilityEntry) => void; members: DomainDataset['members']; adding: boolean; onStartAdd: () => void; onCloseAdd: () => void; onAdd: (kind: AvailabilityKind, input: NewAvailability) => Promise<void>;
}) {
  return <section className="panel"><div className="section-title"><div><h2>Availability — {monthLabel(month)}</h2><span className="hint">PTO, on-call, and velocity overrides</span></div><div className="section-actions"><button type="button" className="btn" onClick={() => onMonthChange(addMonths(month, -1))}>Previous</button><button type="button" className="btn" onClick={() => onMonthChange(monthOf(localToday()))}>Today</button><button type="button" className="btn" onClick={() => onMonthChange(addMonths(month, 1))}>Next</button><button type="button" className="btn primary" data-testid="avail-add" disabled={!editable} onClick={onStartAdd}>＋ Add</button></div></div><div className="subtabs" role="tablist" aria-label="Availability presentation"><button className={`subtab${view === 'calendar' ? ' active' : ''}`} type="button" data-testid="avail-view-calendar" onClick={() => onViewChange('calendar')}>Calendar</button><button className={`subtab${view === 'list' ? ' active' : ''}`} type="button" data-testid="avail-view-list" onClick={() => onViewChange('list')}>List</button></div>{view === 'calendar' ? <AvailabilityCalendar entries={entries} disabled={!editable} onDelete={onDelete} /> : <AvailabilityList entries={entries} disabled={!editable} onDelete={onDelete} />}{adding && <AddAvailabilityModal members={members} onClose={onCloseAdd} onAdd={onAdd} />}</section>;
}

function BandwidthView({ checkIns, month, setMonth, loading, onSelectDate }: { checkIns: BandwidthCheckIn[]; month: string; setMonth: (month: string) => void; loading: boolean; onSelectDate: (date: string, trigger: HTMLButtonElement) => void }) {
  const [calendarMode, setCalendarMode] = useState<'average' | 'count'>('average');
  const days = monthDays(month);
  const leadingDays = new Date(`${month}T12:00:00`).getDay();
  const maxFeelingCount = Math.max(1, ...days.flatMap((date) => feelings.map((feeling) =>
    checkIns.filter((entry) => entry.date === date && entry.feeling === feeling.value).length,
  )));
  return <>
    <section className="panel">
      <div className="section-title">
        <div><h2>Bandwidth — {monthLabel(month)}</h2><span className="hint">Click a past date to add or correct manual check-ins. Use Standup for today.</span></div>
        <div className="section-actions"><button type="button" className="btn" onClick={() => setMonth(addMonths(month, -1))}>Previous</button><button type="button" className="btn" onClick={() => setMonth(monthOf(localToday()))}>Today</button><button type="button" className="btn" onClick={() => setMonth(addMonths(month, 1))}>Next</button></div>
      </div>
      <div className="section-title">
        <span className="hint">{calendarMode === 'average' ? 'Average workload signal' : 'Daily report counts'}. {loading ? 'Loading…' : ''}</span>
        <div className="segmented bandwidth-mode-toggle" role="tablist" aria-label="Bandwidth calendar mode">
          <button type="button" role="tab" aria-label="Average signal" title="Average signal" aria-selected={calendarMode === 'average'} className={`segment${calendarMode === 'average' ? ' active' : ''}`} onClick={() => setCalendarMode('average')}><BandwidthModeIcon mode="average" /></button>
          <button type="button" role="tab" aria-label="Count by feeling" title="Count by feeling" aria-selected={calendarMode === 'count'} className={`segment${calendarMode === 'count' ? ' active' : ''}`} onClick={() => setCalendarMode('count')}><BandwidthModeIcon mode="count" /></button>
        </div>
      </div>
      <div className="bandwidth-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="bandwidth-calendar">{Array.from({ length: leadingDays }, (_, index) => <span className="bandwidth-day-placeholder" key={`leading-${index}`} aria-hidden="true" />)}{days.map((date) => {
        const entries = checkIns.filter((entry) => entry.date === date);
        const counts = Object.fromEntries(feelings.map((feeling) => [feeling.value, entries.filter((entry) => entry.feeling === feeling.value).length])) as Record<BandwidthFeeling, number>;
        const score = entries.length ? entries.reduce((sum, entry) => sum + ({ purple: -1, green: 0, yellow: 1, red: 2 }[entry.feeling]), 0) / entries.length : null;
        const averageColor: BandwidthFeeling | null = score === null ? null : score < -0.5 ? 'purple' : score < 0.5 ? 'green' : score < 1.5 ? 'yellow' : 'red';
        const color = calendarMode === 'average' ? averageColor : null;
        const today = localToday();
        const summary = `${date}: ${entries.length} report${entries.length === 1 ? '' : 's'}${averageColor ? `; average signal ${averageColor}` : ''}`;
        const content = <><span>{Number(date.slice(-2))}</span>{entries.length
          ? calendarMode === 'count'
            ? <BandwidthCountBars date={date} counts={counts} maxCount={maxFeelingCount} />
            : <small>{counts.red}R {counts.yellow}Y {counts.green}G {counts.purple}P</small>
          : <small>—</small>}</>;
        const className = `bandwidth-day${calendarMode === 'count' ? ' count-mode' : ''}${color ? ` feeling-${color}` : ''}`;
        if (date > today) return <div key={date} className={`${className} is-unavailable`} aria-label={`${summary}; future date unavailable`}>{content}</div>;
        const action = date < today ? 'Open historical check-ins' : "View today's check-ins; use Standup to edit";
        return <button key={date} type="button" className={className} aria-label={`${summary}; ${action}`} title={action} onClick={(event) => onSelectDate(date, event.currentTarget)}>{content}</button>;
      })}</div>
    </section>
  </>;
}

function BandwidthModeIcon({ mode }: { mode: 'average' | 'count' }) {
  return mode === 'average'
    ? <svg className="bandwidth-mode-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17l4.5-5 4 3 5-7 4.5 3.5" /><path className="axis" d="M3 20h18" /></svg>
    : <svg className="bandwidth-mode-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h8M4 12h16M4 18h11" /></svg>;
}

function BandwidthCountBars({ date, counts, maxCount }: { date: string; counts: Record<BandwidthFeeling, number>; maxCount: number }) {
  return <div className="bandwidth-count-bars">{feelings.map(({ value }) => {
    const count = counts[value];
    const label = `${count} ${value} report${count === 1 ? '' : 's'}`;
    const tooltipId = `bandwidth-count-${date}-${value}`;
    return <div className="bandwidth-count-row" key={value}>
      <div className="bandwidth-count-track" aria-label={`${date}: ${label}`}>
        <span className={`bandwidth-count-fill feeling-${value}`} style={{ width: `${count / maxCount * 100}%` }} aria-hidden="true" />
        <span id={tooltipId} className="bandwidth-count-tooltip" role="tooltip">{label}</span>
      </div>
    </div>;
  })}</div>;
}
