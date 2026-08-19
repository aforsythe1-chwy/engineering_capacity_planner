import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BandwidthCheckIn, BandwidthFeeling, DomainDataset } from '@ecp/shared';
import * as api from '../data/api';
import { buildAvailabilityEntries, type AvailabilityEntry, type AvailabilityKind } from '../lib/availability';
import { memberColorMap } from '../lib/memberColors';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { AvailabilityList } from './AvailabilityList';
import { AddAvailabilityModal, type NewAvailability } from './AddAvailabilityModal';

type TeamView = 'bandwidth' | 'availability';
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
  const team = dataset.teams.find((candidate) => candidate.id === teamId) ?? dataset.teams[0] ?? null;
  const members = useMemo(() => team ? dataset.members.filter((member) => member.teamId === team.id) : [], [dataset.members, team]);
  const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);
  const visibleMembers = memberId ? members.filter((member) => member.id === memberId) : members;
  const visibleCheckIns = useMemo(() => memberId ? checkIns.filter((checkIn) => checkIn.memberId === memberId) : checkIns, [checkIns, memberId]);
  const colors = useMemo(() => memberColorMap(members), [members]);

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

  if (!team) return <main className="team-page"><section className="panel">No team is configured yet.</section></main>;
  return <main className="team-page" data-testid="team-page">
    <section className="panel team-header">
      <div><h2>Team</h2><p className="hint">Calendar analysis for availability and self-reported workload. Epic filters do not change this view.</p></div>
      <div className="team-controls">
        {dataset.teams.length > 1 && <label className="control"><span>Team</span><select value={team.id} onChange={(event) => onTeamChange(event.target.value)}>{dataset.teams.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>}
        <TeamMemberPicker members={activeMembers} value={memberId} onChange={setMemberId} />
        <div className="segmented team-view-toggle" role="tablist" aria-label="Team data view">
          {(['bandwidth', 'availability'] as TeamView[]).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} className={`segment${view === item ? ' active' : ''}`} onClick={() => setView(item)}>{item === 'bandwidth' ? 'Bandwidth' : 'Availability'}</button>)}
        </div>
      </div>
    </section>
    {error && <div className="panel config-error" role="alert">⚠ {error}</div>}
    {view === 'bandwidth'
      ? <BandwidthView checkIns={visibleCheckIns} month={month} setMonth={setMonth} loading={loading} />
      : <section className="panel"><div className="section-title"><div><h2>Availability — {monthLabel(month)}</h2><span className="hint">PTO, on-call, and velocity overrides</span></div><div className="section-actions"><button type="button" className="btn" onClick={() => setMonth(addMonths(month, -1))}>Previous</button><button type="button" className="btn" onClick={() => setMonth(monthOf(localToday()))}>Today</button><button type="button" className="btn" onClick={() => setMonth(addMonths(month, 1))}>Next</button><button type="button" className="btn primary" data-testid="avail-add" disabled={!editable} onClick={() => setAddingAvailability(true)}>＋ Add</button></div></div><div className="subtabs" role="tablist" aria-label="Availability presentation"><button className={`subtab${availabilityView === 'calendar' ? ' active' : ''}`} type="button" data-testid="avail-view-calendar" onClick={() => setAvailabilityView('calendar')}>Calendar</button><button className={`subtab${availabilityView === 'list' ? ' active' : ''}`} type="button" data-testid="avail-view-list" onClick={() => setAvailabilityView('list')}>List</button></div>{availabilityView === 'calendar' ? <AvailabilityCalendar entries={availabilityEntries} disabled={!editable} onDelete={deleteAvailability} /> : <AvailabilityList entries={availabilityEntries} disabled={!editable} onDelete={deleteAvailability} />}{addingAvailability && <AddAvailabilityModal members={activeMembers} onClose={() => setAddingAvailability(false)} onAdd={addAvailability} />}</section>}
  </main>;
}

function TeamMemberPicker({ members, value, onChange }: { members: DomainDataset['members']; value: string; onChange: (memberId: string) => void }) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = members.find((member) => member.id === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const select = (memberId: string) => {
    onChange(memberId);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const focusOption = (index: number) => optionRefs.current[(index + members.length + 1) % (members.length + 1)]?.focus();

  return <div className="member-picker" ref={containerRef}>
    <span className="member-picker-label">Engineer</span>
    <button ref={triggerRef} className="member-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focusOption(value ? Math.max(0, members.findIndex((member) => member.id === value)) + 1 : 0)); }
      if (event.key === 'Escape') setOpen(false);
    }}><span>{selected?.name ?? 'All team'}</span><span className="member-picker-chevron" aria-hidden="true">⌄</span></button>
    {open && <div id={listboxId} className="member-picker-menu" role="listbox" aria-label="Engineer">{[{ id: '', name: 'All team' }, ...members].map((member, index) => <button ref={(element) => { optionRefs.current[index] = element; }} key={member.id || 'all'} type="button" role="option" aria-selected={member.id === value} className={`member-picker-option${member.id === value ? ' is-selected' : ''}`} onClick={() => select(member.id)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(Math.min(index + 1, members.length)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); index === 0 ? triggerRef.current?.focus() : focusOption(index - 1); }
      if (event.key === 'Home') { event.preventDefault(); focusOption(0); }
      if (event.key === 'End') { event.preventDefault(); focusOption(members.length); }
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    }}><span>{member.name}</span>{member.id === value && <span aria-hidden="true">✓</span>}</button>)}</div>}
  </div>;
}

function BandwidthView({ checkIns, month, setMonth, loading }: { checkIns: BandwidthCheckIn[]; month: string; setMonth: (month: string) => void; loading: boolean }) {
  const [calendarMode, setCalendarMode] = useState<'average' | 'count'>('average');
  const days = monthDays(month);
  const maxFeelingCount = Math.max(1, ...days.flatMap((date) => feelings.map((feeling) =>
    checkIns.filter((entry) => entry.date === date && entry.feeling === feeling.value).length,
  )));
  return <>
    <section className="panel">
      <div className="section-title">
        <div><h2>Bandwidth — {monthLabel(month)}</h2><span className="hint">Calendar analysis only. Use Standup to collect daily check-ins.</span></div>
        <div className="section-actions"><button type="button" className="btn" onClick={() => setMonth(addMonths(month, -1))}>Previous</button><button type="button" className="btn" onClick={() => setMonth(monthOf(localToday()))}>Today</button><button type="button" className="btn" onClick={() => setMonth(addMonths(month, 1))}>Next</button></div>
      </div>
      <div className="section-title">
        <span className="hint">{calendarMode === 'average' ? 'Average workload signal' : 'Daily report counts'}. {loading ? 'Loading…' : ''}</span>
        <div className="segmented bandwidth-mode-toggle" role="tablist" aria-label="Bandwidth calendar mode">
          <button type="button" role="tab" aria-label="Average signal" title="Average signal" aria-selected={calendarMode === 'average'} className={`segment${calendarMode === 'average' ? ' active' : ''}`} onClick={() => setCalendarMode('average')}><BandwidthModeIcon mode="average" /></button>
          <button type="button" role="tab" aria-label="Count by feeling" title="Count by feeling" aria-selected={calendarMode === 'count'} className={`segment${calendarMode === 'count' ? ' active' : ''}`} onClick={() => setCalendarMode('count')}><BandwidthModeIcon mode="count" /></button>
        </div>
      </div>
      <div className="bandwidth-calendar">{days.map((date) => {
        const entries = checkIns.filter((entry) => entry.date === date);
        const counts = Object.fromEntries(feelings.map((feeling) => [feeling.value, entries.filter((entry) => entry.feeling === feeling.value).length])) as Record<BandwidthFeeling, number>;
        const score = entries.length ? entries.reduce((sum, entry) => sum + ({ purple: -1, green: 0, yellow: 1, red: 2 }[entry.feeling]), 0) / entries.length : null;
        const averageColor: BandwidthFeeling | null = score === null ? null : score < -0.5 ? 'purple' : score < 0.5 ? 'green' : score < 1.5 ? 'yellow' : 'red';
        const color = calendarMode === 'average' ? averageColor : null;
        return <div key={date} className={`bandwidth-day${calendarMode === 'count' ? ' count-mode' : ''}${color ? ` feeling-${color}` : ''}`} aria-label={`${date}: ${entries.length} reports`}>
          <span>{Number(date.slice(-2))}</span>
          {entries.length
            ? calendarMode === 'count'
              ? <BandwidthCountBars date={date} counts={counts} maxCount={maxFeelingCount} />
              : <small>{counts.red}R {counts.yellow}Y {counts.green}G {counts.purple}P</small>
            : <small>—</small>}
        </div>;
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
      <div className="bandwidth-count-track" tabIndex={0} aria-label={`${date}: ${label}`} aria-describedby={tooltipId}>
        <span className={`bandwidth-count-fill feeling-${value}`} style={{ width: `${count / maxCount * 100}%` }} aria-hidden="true" />
        <span id={tooltipId} className="bandwidth-count-tooltip" role="tooltip">{label}</span>
      </div>
    </div>;
  })}</div>;
}
