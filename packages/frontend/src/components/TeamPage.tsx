import { useEffect, useMemo, useState } from 'react';
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
  const visibleMembers = memberId ? members.filter((member) => member.id === memberId) : members;
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
        <label className="control"><span>Engineer</span><select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">All team</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}{member.active ? '' : ' (inactive)'}</option>)}</select></label>
        <div className="segmented" role="tablist" aria-label="Team data view">
          {(['bandwidth', 'availability'] as TeamView[]).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} className={`segment${view === item ? ' active' : ''}`} onClick={() => setView(item)}>{item === 'bandwidth' ? 'Bandwidth' : 'Availability'}</button>)}
        </div>
      </div>
    </section>
    {error && <div className="panel config-error" role="alert">⚠ {error}</div>}
    {view === 'bandwidth'
      ? <BandwidthView checkIns={checkIns} month={month} setMonth={setMonth} loading={loading} />
      : <section className="panel"><div className="section-title"><div><h2>Availability — {monthLabel(month)}</h2><span className="hint">PTO, on-call, and velocity overrides</span></div><div className="section-actions"><button type="button" className="btn" onClick={() => setMonth(addMonths(month, -1))}>Previous</button><button type="button" className="btn" onClick={() => setMonth(monthOf(localToday()))}>Today</button><button type="button" className="btn" onClick={() => setMonth(addMonths(month, 1))}>Next</button><button type="button" className="btn primary" data-testid="avail-add" disabled={!editable} onClick={() => setAddingAvailability(true)}>＋ Add</button></div></div><div className="subtabs" role="tablist" aria-label="Availability presentation"><button className={`subtab${availabilityView === 'calendar' ? ' active' : ''}`} type="button" data-testid="avail-view-calendar" onClick={() => setAvailabilityView('calendar')}>Calendar</button><button className={`subtab${availabilityView === 'list' ? ' active' : ''}`} type="button" data-testid="avail-view-list" onClick={() => setAvailabilityView('list')}>List</button></div>{availabilityView === 'calendar' ? <AvailabilityCalendar entries={availabilityEntries} disabled={!editable} onDelete={deleteAvailability} /> : <AvailabilityList entries={availabilityEntries} disabled={!editable} onDelete={deleteAvailability} />}{addingAvailability && <AddAvailabilityModal members={members.filter((member) => member.active)} onClose={() => setAddingAvailability(false)} onAdd={addAvailability} />}</section>}
  </main>;
}

function BandwidthView({ checkIns, month, setMonth, loading }: { checkIns: BandwidthCheckIn[]; month: string; setMonth: (month: string) => void; loading: boolean }) {
  const [calendarMode, setCalendarMode] = useState<'average' | 'count'>('average');
  const [countFeeling, setCountFeeling] = useState<BandwidthFeeling>('red');
  const days = monthDays(month);
  return <>
    <section className="panel"><div className="section-title"><div><h2>Bandwidth — {monthLabel(month)}</h2><span className="hint">Calendar analysis only. Use Standup to collect daily check-ins.</span></div><div className="section-actions"><button type="button" className="btn" onClick={() => setMonth(addMonths(month, -1))}>Previous</button><button type="button" className="btn" onClick={() => setMonth(monthOf(localToday()))}>Today</button><button type="button" className="btn" onClick={() => setMonth(addMonths(month, 1))}>Next</button></div></div><div className="section-title"><span className="hint">{calendarMode === 'average' ? 'Average workload signal' : `Count of ${countFeeling} reports`}. {loading ? 'Loading…' : ''}</span><div className="segmented" role="tablist" aria-label="Bandwidth calendar mode"><button type="button" role="tab" aria-selected={calendarMode === 'average'} className={`segment${calendarMode === 'average' ? ' active' : ''}`} onClick={() => setCalendarMode('average')}>Average signal</button><button type="button" role="tab" aria-selected={calendarMode === 'count'} className={`segment${calendarMode === 'count' ? ' active' : ''}`} onClick={() => setCalendarMode('count')}>Count by feeling</button></div></div>{calendarMode === 'count' && <div className="bandwidth-count-filter" role="radiogroup" aria-label="Feeling to count">{feelings.map((feeling) => <button type="button" key={feeling.value} role="radio" aria-checked={countFeeling === feeling.value} className={`feeling feeling-${feeling.value}${countFeeling === feeling.value ? ' active' : ''}`} onClick={() => setCountFeeling(feeling.value)}>{feeling.label}</button>)}</div>}<div className="bandwidth-calendar">{days.map((date) => { const entries = checkIns.filter((entry) => entry.date === date); const counts = Object.fromEntries(feelings.map((feeling) => [feeling.value, entries.filter((entry) => entry.feeling === feeling.value).length])) as Record<BandwidthFeeling, number>; const score = entries.length ? entries.reduce((sum, entry) => sum + ({ purple: -1, green: 0, yellow: 1, red: 2 }[entry.feeling]), 0) / entries.length : null; const averageColor: BandwidthFeeling | null = score === null ? null : score < -0.5 ? 'purple' : score < 0.5 ? 'green' : score < 1.5 ? 'yellow' : 'red'; const color = calendarMode === 'average' ? averageColor : counts[countFeeling] > 0 ? countFeeling : null; return <div key={date} className={`bandwidth-day${color ? ` feeling-${color}` : ''}`} aria-label={`${date}: ${entries.length} reports`}><span>{Number(date.slice(-2))}</span><small>{entries.length ? calendarMode === 'count' ? `${counts[countFeeling]} ${countFeeling}` : `${counts.red}R ${counts.yellow}Y ${counts.green}G ${counts.purple}P` : '—'}</small></div>; })}</div></section>
  </>;
}
