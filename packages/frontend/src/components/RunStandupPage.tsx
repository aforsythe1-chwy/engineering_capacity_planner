import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Users } from 'lucide-react';
import { effectivePortfolioEpic, epicOwnerId, epicSmes, globalStringSetting, SETTING_KEYS, STANDUP_DEFAULTS, type BandwidthCheckIn, type BandwidthFeeling, type DomainDataset, type IntakeRequest, type StandupIntakeContext, type StandupMemberTicketContext, type StandupParticipant, type TeamStandupAudioSettings } from '@ecp/shared';
import * as api from '../data/api';
import { boardPresentation, groupStandupTickets, parsePresentation, standupTicketGroupTone } from '../lib/standupStatusPresentation';
import { deriveStandupRequiredPeople } from '../lib/standupRequiredPeople';
import { colorFor, memberColorMap } from '../lib/memberColors';
import { StandupSpeakerTimer } from './StandupSpeakerTimer';
import { StandupFireEffect } from './StandupFireEffect';
import { StandupNoteComposer } from './StandupNoteComposer';
import { MemberAvatar } from './MemberAvatar';
import { useStandupWalkOffAudio } from '../lib/useStandupWalkOffAudio';
import { DatePicker } from './DatePicker';

const feelings: Array<{ value: BandwidthFeeling; label: string; description: string }> = [
  { value: 'purple', label: 'Purple', description: "I don't have enough work to do" },
  { value: 'green', label: 'Green', description: "I'd be happy if I had this amount of work all the time" },
  { value: 'yellow', label: 'Yellow', description: "Things are getting overloaded, but I'm managing" },
  { value: 'red', label: 'Red', description: 'Drowning' },
];
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const epicRoleOrder = { owner: 0, sme: 1, other: 2 };

export function RunStandupPage({ dataset, teamId, editable, onTeamChange }: { dataset: DomainDataset; teamId: string | null; editable: boolean; onTeamChange: (teamId: string) => void }) {
  const team = dataset.teams.find((candidate) => candidate.id === teamId) ?? dataset.teams[0] ?? null;
  const [aggregate, setAggregate] = useState<api.StandupAggregate | null>(null); const [error, setError] = useState<string | null>(null); const launch = useRef<HTMLButtonElement>(null);
  const [sessions, setSessions] = useState<import('@ecp/shared').StandupSession[]>([]);
  const refreshSessions = async () => { if (team && editable) setSessions((await api.listStandups(team.id)).sessions); };
  useEffect(() => { void refreshSessions(); }, [team?.id, editable]);
  const open = async () => { if (!team || !editable) return; setError(null); try { setAggregate(await api.startStandup(team.id, localToday())); await refreshSessions(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  if (!team) return <main className="team-page"><section className="panel">No team is configured yet.</section></main>;
  const openRecord = async (sessionId: string) => { try { setAggregate(await api.getStandup(sessionId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return <main className="team-page" data-testid="standup-page"><section className="panel team-header standup-launch"><div><h2>Standup</h2><p className="hint">Review the current sprint, capture today’s bandwidth, and record team follow-ups.</p></div><div className="team-controls">{dataset.teams.length > 1 && <label className="control"><span>Team</span><select value={team.id} onChange={(e) => onTeamChange(e.target.value)}>{dataset.teams.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>}<button ref={launch} className="btn primary" disabled={!editable} onClick={() => { void open(); }}>Start Standup</button></div></section><section className="panel standup-session-list"><h3>Standup records</h3>{sessions.length ? sessions.map((session) => <p key={session.id}><button type="button" className="link-btn" onClick={() => void openRecord(session.id)}>{session.date}</button>{session.status === 'completed' && <span className="hint"> Completed</span>}</p>) : <p className="hint">No saved standups.</p>}</section>{!editable && <div className="panel config-notice">Bundled sample data is read-only. Start the backend to facilitate a standup.</div>}{error && <div className="panel config-error" role="alert">⚠ {error}</div>}{aggregate && <StandupModal dataset={dataset} aggregate={aggregate} onChange={(value) => { setAggregate(value); void refreshSessions(); }} onClose={() => { setAggregate(null); void refreshSessions(); launch.current?.focus(); }} onError={setError} />}</main>;
}

function StandupModal({ dataset, aggregate, onChange, onClose, onError }: { dataset: DomainDataset; aggregate: api.StandupAggregate; onChange: (value: api.StandupAggregate) => void; onClose: () => void; onError: (value: string | null) => void }) {
  useEffect(() => { const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previousOverflow; }; }, []);
  const [ticketStates, setTicketStates] = useState<Record<string, { context: StandupMemberTicketContext | null; refreshing: boolean }>>({});
  const [intakeState, setIntakeState] = useState<{ context: StandupIntakeContext | null; refreshing: boolean; message: string | null }>({ context: null, refreshing: false, message: null });
  const [timerState, setTimerState] = useState({ overTime: false, paused: false, heat: 0 });
  const [audioSettings, setAudioSettings] = useState<TeamStandupAudioSettings | null>(null);
  const handleOvertimeChange = useCallback((overTime: boolean, paused: boolean, heat: number) => setTimerState((current) => current.overTime === overTime && current.paused === paused && current.heat === heat ? current : { overTime, paused, heat }), []);
  const snapshotRequests = useRef(new Map<string, Promise<StandupMemberTicketContext | null>>()); const refreshRequests = useRef(new Map<string, Promise<StandupMemberTicketContext>>());
  const intakeSnapshot = useRef(new Map<string, Promise<StandupIntakeContext | null>>()); const intakeRefresh = useRef(new Map<string, Promise<StandupIntakeContext>>());
  const current = aggregate.participants.find((p) => p.disposition === 'pending'); const pending = aggregate.participants.filter((p) => p.disposition === 'pending'); const done = aggregate.participants.filter((p) => p.disposition !== 'pending').length;
  const currentMemberId = pending[0]?.memberId; const nextMemberId = pending[1]?.memberId;
  useEffect(() => { void api.getTeamStandupAudio(aggregate.session.teamId).then(setAudioSettings).catch(() => setAudioSettings(null)); }, [aggregate.session.teamId]);
  useStandupWalkOffAudio({ settings: audioSettings, memberId: currentMemberId, heat: timerState.heat, paused: timerState.paused, active: aggregate.session.status === 'active' });
  const [canAdvance, setCanAdvance] = useState(() => Boolean(currentMemberId && aggregate.checkIns.some((entry) => entry.memberId === currentMemberId)));
  useEffect(() => { setCanAdvance(Boolean(currentMemberId && aggregate.checkIns.some((entry) => entry.memberId === currentMemberId))); }, [aggregate.checkIns, currentMemberId]);
  useEffect(() => {
    let active = true; const memberIds = [currentMemberId, nextMemberId].filter((id): id is string => Boolean(id));
    const publish = (memberId: string, context: StandupMemberTicketContext | null, refreshing?: boolean) => { if (!active) return; setTicketStates((states) => { const previous = states[memberId]; const newer = !context || !previous?.context || context.capturedAt >= previous.context.capturedAt ? context : previous.context; return { ...states, [memberId]: { context: newer, refreshing: refreshing ?? previous?.refreshing ?? false } }; }); };
    for (const memberId of memberIds) {
      const key = `${aggregate.session.id}:${memberId}`;
      publish(memberId, null, true);
      let snapshot = snapshotRequests.current.get(key);
      if (!snapshot) { snapshot = api.getStandupMemberTickets(aggregate.session.id, memberId).catch(() => null); snapshotRequests.current.set(key, snapshot); }
      void snapshot.then((context) => publish(memberId, context));
      let refresh = refreshRequests.current.get(key);
      if (!refresh) { refresh = api.refreshStandupMemberTickets(aggregate.session.id, memberId); refreshRequests.current.set(key, refresh); }
      void refresh.then((context) => publish(memberId, context, false)).catch(() => publish(memberId, { memberId, capturedAt: new Date().toISOString(), source: 'snapshot', freshness: 'unavailable', tickets: [], errorMessage: 'Tickets unavailable.', truncated: false }, false)).finally(() => { refreshRequests.current.delete(key); });
    }
    return () => { active = false; };
  }, [aggregate.session.id, currentMemberId, nextMemberId]);
  const publishIntake = useCallback((context: StandupIntakeContext | null, refreshing?: boolean, message?: string | null) => {
    setIntakeState((currentState) => ({ context: !context || !currentState.context || context.capturedAt >= currentState.context.capturedAt ? context : currentState.context, refreshing: refreshing ?? currentState.refreshing, message: message ?? currentState.message }));
  }, []);
  const loadIntake = useCallback((manual = false) => {
    const sessionId = aggregate.session.id; publishIntake(intakeState.context, true, manual ? null : intakeState.message);
    let snapshot = intakeSnapshot.current.get(sessionId);
    if (!snapshot) { snapshot = api.getStandupIntakeRequests(sessionId).catch(() => null); intakeSnapshot.current.set(sessionId, snapshot); }
    void snapshot.then((context) => publishIntake(context));
    let refresh = intakeRefresh.current.get(sessionId);
    if (!refresh) { refresh = api.refreshStandupIntakeRequests(sessionId); intakeRefresh.current.set(sessionId, refresh); }
    void refresh.then((context) => publishIntake(context, false, manual ? 'Intake requests synced.' : null)).catch((error) => publishIntake(null, false, error instanceof Error ? error.message : 'Intake requests unavailable.')).finally(() => intakeRefresh.current.delete(sessionId));
  }, [aggregate.session.id, intakeState.context, intakeState.message, publishIntake]);
  useEffect(() => { if (aggregate.session.status !== 'completed') loadIntake(); }, [aggregate.session.id]);
  const resolve = async (disposition: 'completed' | 'skipped') => { if (!current) return; try { onChange(await api.resolveStandupParticipant(aggregate.session.id, current.memberId, disposition, aggregate.session.revision)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } };
  const finish = async () => { try { onChange(await api.finishStandup(aggregate.session.id, aggregate.session.revision)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } };
  const remove = async () => { if (!window.confirm('Delete this standup and its saved bandwidth and notes?')) return; try { await api.deleteStandup(aggregate.session.id); onClose(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } };
  const threshold = (() => { try { const value = JSON.parse(dataset.settings.find((row) => row.scope === 'global' && row.key === SETTING_KEYS.STANDUP_SPEAKER_THRESHOLD_SECONDS)?.value ?? 'null'); return Number.isInteger(value) ? value : STANDUP_DEFAULTS.SPEAKER_THRESHOLD_SECONDS; } catch { return STANDUP_DEFAULTS.SPEAKER_THRESHOLD_SECONDS; } })();
  const isActiveRound = aggregate.session.status === 'active' && Boolean(current);
  return <div className="modal-backdrop standup-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal standup-modal${isActiveRound ? ' is-active-round' : ''}${timerState.overTime ? ` is-over-time standup-heat-${timerState.heat}` : ''}${timerState.paused ? ' is-timer-paused' : ''}`} role="dialog" aria-modal="true" aria-labelledby="standup-title">{timerState.overTime && <StandupFireEffect paused={timerState.paused} heat={timerState.heat} />}<header className="modal-heading"><div><h2 id="standup-title">{aggregate.session.status === 'post_standup' ? 'Post-standup notes' : 'Standup'}</h2><p className="hint">{aggregate.session.sprintName ?? 'Sprint unavailable'} · {aggregate.session.date} · {aggregate.session.status === 'active' ? `${done} of ${aggregate.participants.length}` : aggregate.session.status === 'completed' ? 'Completed' : 'Post-standup'}</p></div><button className="modal-close" aria-label="Close standup" onClick={onClose}>×</button></header>{isActiveRound && current ? <TeamRound dataset={dataset} aggregate={aggregate} participant={current} ticketContext={ticketStates[current.memberId]?.context ?? null} ticketRefreshing={ticketStates[current.memberId]?.refreshing ?? false} onChange={onChange} onSelectionChange={setCanAdvance} timer={<StandupSpeakerTimer timerKey={`${aggregate.session.id}:${current.memberId}`} thresholdSeconds={threshold} onOvertimeChange={handleOvertimeChange} />} /> : aggregate.session.status === 'post_standup' ? <PostStandup dataset={dataset} aggregate={aggregate} onChange={onChange} intake={intakeState} onSync={() => loadIntake(true)} /> : <Notes dataset={dataset} aggregate={aggregate} onChange={onChange} />}{isActiveRound && <footer className="modal-actions standup-actions" data-testid="standup-actions"><button className="btn" onClick={() => void resolve('skipped')}>Skip</button><button className="btn primary" disabled={!canAdvance} onClick={() => void resolve('completed')}>Next</button></footer>}{aggregate.session.status === 'post_standup' && <footer className="modal-actions"><button className="btn primary" onClick={() => void finish()}>Finish Standup</button></footer>}{aggregate.session.status === 'completed' && <footer className="modal-actions"><button className="btn danger" onClick={() => void remove()}>Delete</button></footer>}</section></div>;
}

function TeamRound({ dataset, aggregate, participant, ticketContext, ticketRefreshing, onChange, onSelectionChange, timer }: { dataset: DomainDataset; aggregate: api.StandupAggregate; participant: StandupParticipant; ticketContext: StandupMemberTicketContext | null; ticketRefreshing: boolean; onChange: (value: api.StandupAggregate) => void; onSelectionChange: (selected: boolean) => void; timer: ReactNode }) {
  const [checkIns, setCheckIns] = useState<BandwidthCheckIn[]>(aggregate.checkIns);
  const entry = checkIns.find((item) => item.memberId === participant.memberId && item.date === aggregate.session.date); const epics = useMemo(() => dataset.epics.filter((epic) => epic.teamId === aggregate.session.teamId && effectivePortfolioEpic(dataset, epic.key).tracked).map((epic) => { const ownerId = epicOwnerId(dataset, epic.key); const role: keyof typeof epicRoleOrder = ownerId === participant.memberId ? 'owner' : epicSmes(dataset, epic.key).some((sme) => sme.memberId === participant.memberId) ? 'sme' : 'other'; return { epic, owner: dataset.members.find((member) => member.id === ownerId), role }; }).sort((a, b) => epicRoleOrder[a.role] - epicRoleOrder[b.role] || a.epic.key.localeCompare(b.epic.key)), [dataset, aggregate.session.teamId, participant.memberId]);
  const presentation = boardPresentation(parsePresentation(dataset.settings.find((row) => row.scope === 'global' && row.key === SETTING_KEYS.STANDUP_STATUS_PRESENTATION)?.value), globalStringSetting(dataset.settings, SETTING_KEYS.JIRA_BOARD_ID));
  return <div className="standup-grid" data-testid="standup-round-body"><aside className="standup-sidebar"><Notes dataset={dataset} aggregate={aggregate} onChange={onChange} compact /><section className="standup-current-epics" aria-labelledby="standup-current-epics-heading"><h3 id="standup-current-epics-heading">Current epics</h3>{epics.length ? <div className="standup-epic-list standup-epic-scroll-region" data-testid="standup-epic-scroll-region">{epics.map(({ epic, owner, role }) => <article className={`standup-epic-card is-${role}`} key={epic.key}><div className="standup-epic-heading"><strong>{epic.key}</strong>{role === 'owner' && <span className="standup-leader" aria-label="You are the epic leader"><span aria-hidden="true">♛</span> Leader</span>}{role === 'sme' && <span className="standup-sme">SME</span>}</div><span>{epic.title}</span><small>{role === 'owner' ? 'You own this epic' : role === 'sme' ? 'You are an SME' : owner ? `Owner · ${owner.name}` : 'Unowned'}</small></article>)}</div> : <p className="hint">No current epics.</p>}</section></aside><div className="standup-round-content"><div className="standup-speaker-heading"><div><h3>{participant.memberName}</h3><p className="hint">Participant {participant.position + 1} of {aggregate.participants.length}</p></div>{timer}</div><StandupBandwidthCheckIn sessionId={aggregate.session.id} memberId={participant.memberId} date={aggregate.session.date} entry={entry} onSelectionChange={onSelectionChange} onSaved={(saved) => setCheckIns((items) => [...items.filter((item) => item.memberId !== saved.memberId || item.date !== saved.date), saved])} onRemoved={() => setCheckIns((items) => items.filter((item) => item.memberId !== participant.memberId || item.date !== aggregate.session.date))} /><StandupTickets context={ticketContext} refreshing={ticketRefreshing} entries={presentation?.entries} /></div></div>;
}

function StandupBandwidthCheckIn({ sessionId, memberId, date, entry, onSaved, onRemoved, onSelectionChange }: { sessionId: string; memberId: string; date: string; entry: BandwidthCheckIn | undefined; onSaved: (entry: BandwidthCheckIn) => void; onRemoved: () => void; onSelectionChange: (selected: boolean) => void }) {
  const editorKey = `${memberId}:${date}`;
  const [selected, setSelected] = useState<BandwidthFeeling | undefined>(entry?.feeling);
  const [confirmedFeeling, setConfirmedFeeling] = useState<BandwidthFeeling | undefined>(entry?.feeling);
  const [draft, setDraft] = useState(entry?.note ?? '');
  const [contextOpen, setContextOpen] = useState(Boolean(entry?.note));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ feeling: BandwidthFeeling; note: string } | null>(null);
  const requestSequence = useRef(new Map<string, number>());
  const activeKey = useRef(editorKey);
  const draftRef = useRef(entry?.note ?? '');
  const confirmedNoteRef = useRef(entry?.note ?? '');

  useEffect(() => {
    activeKey.current = editorKey;
    setSelected(entry?.feeling); setConfirmedFeeling(entry?.feeling);
    draftRef.current = entry?.note ?? ''; confirmedNoteRef.current = entry?.note ?? '';
    setDraft(draftRef.current);
    setContextOpen(Boolean(entry?.note)); setSaving(false); setError(null); setRetry(null);
  }, [editorKey]);
  useEffect(() => { onSelectionChange(Boolean(selected)); }, [onSelectionChange, selected]);

  const save = async (feeling: BandwidthFeeling, note: string) => {
    const sequence = (requestSequence.current.get(editorKey) ?? 0) + 1;
    requestSequence.current.set(editorKey, sequence);
    if (activeKey.current === editorKey) { setSaving(true); setError(null); setRetry(null); }
    try {
      const saved = await api.upsertStandupCheckIn(sessionId, memberId, { feeling, note });
      if (requestSequence.current.get(editorKey) !== sequence) return;
      onSaved(saved);
      if (activeKey.current === editorKey) {
        setSelected(saved.feeling); setConfirmedFeeling(saved.feeling);
        confirmedNoteRef.current = saved.note ?? '';
        setSaving(false);
      }
    } catch (reason) {
      if (requestSequence.current.get(editorKey) !== sequence || activeKey.current !== editorKey) return;
      setSelected(confirmedFeeling); setSaving(false);
      setError(reason instanceof Error ? reason.message : 'Could not save bandwidth check-in.');
      setRetry({ feeling, note });
    }
  };

  const chooseFeeling = (feeling: BandwidthFeeling) => {
    setSelected(feeling); setError(null); setRetry(null);
    void save(feeling, draft);
  };
  const saveNote = () => {
    if (!selected || draftRef.current === confirmedNoteRef.current) return;
    void save(selected, draftRef.current);
  };
  const clear = async () => {
    const sequence = (requestSequence.current.get(editorKey) ?? 0) + 1;
    requestSequence.current.set(editorKey, sequence);
    setSaving(true); setError(null); setRetry(null);
    try {
      await api.deleteStandupCheckIn(sessionId, memberId);
      if (requestSequence.current.get(editorKey) !== sequence || activeKey.current !== editorKey) return;
      onRemoved(); setSelected(undefined); setConfirmedFeeling(undefined);
      draftRef.current = ''; confirmedNoteRef.current = '';
      setDraft(''); setContextOpen(false); setSaving(false);
    } catch (reason) {
      if (requestSequence.current.get(editorKey) !== sequence || activeKey.current !== editorKey) return;
      setSaving(false); setError(reason instanceof Error ? reason.message : 'Could not clear bandwidth check-in.');
    }
  };

  return <section className="standup-bandwidth" aria-describedby={`${editorKey}-bandwidth-status`}>
    <fieldset><legend>Bandwidth check-in</legend><p className="hint">How is your workload today?</p><div className="standup-bandwidth-options">{feelings.map((feeling) => { const optionId = `${editorKey}-${feeling.value}`; const tooltipId = `${optionId}-description`; return <div key={feeling.value} className={`standup-bandwidth-option feeling-${feeling.value}${selected === feeling.value ? ' is-selected' : ''}`}><input id={optionId} type="radio" name={`${editorKey}-bandwidth`} value={feeling.value} checked={selected === feeling.value} onClick={(event) => { if (selected === feeling.value) { event.preventDefault(); event.currentTarget.blur(); void clear(); } }} onChange={() => chooseFeeling(feeling.value)} /><label htmlFor={optionId}><span className="standup-bandwidth-check" aria-hidden="true">✓</span><span className="standup-bandwidth-color" aria-hidden="true" /><span>{feeling.label}</span></label><button type="button" className="standup-bandwidth-info" aria-label={`What does ${feeling.label} mean?`} aria-describedby={tooltipId}>i</button><span id={tooltipId} className="standup-bandwidth-tooltip" role="tooltip">{feeling.description}</span></div>; })}</div></fieldset>
    {selected && <div className="standup-bandwidth-context">{contextOpen ? <label className="control"><span>Context (optional)</span><input type="text" maxLength={2000} value={draft} onChange={(event) => { draftRef.current = event.target.value; setDraft(event.target.value); }} onBlur={saveNote} placeholder="Add context" /></label> : <button type="button" className="link-btn" onClick={() => setContextOpen(true)}>Add context (optional)</button>}</div>}
    <div id={`${editorKey}-bandwidth-status`} className="standup-bandwidth-status" aria-live="polite">{saving ? 'Saving…' : error ? <><span role="alert">Could not save. Your changes are still here.</span> <button type="button" className="link-btn" onClick={() => retry && void save(retry.feeling, retry.note)}>Retry</button></> : null}</div>
  </section>;
}

function StandupTickets({ context, refreshing, entries }: { context: StandupMemberTicketContext | null; refreshing: boolean; entries?: import('@ecp/shared').StandupStatusPresentationEntry[] }) {
  if (!context) return <section className="standup-tickets" aria-live="polite" aria-busy="true"><div className="standup-ticket-heading"><h3>Sprint tickets</h3><span className="standup-ticket-loading"><span className="standup-spinner" aria-hidden="true" />Refreshing</span></div><p className="hint">Refreshing current-sprint tickets…</p></section>;
  if (context.freshness === 'unavailable') return <section className="standup-tickets" aria-live="polite"><div className="standup-ticket-heading"><h3>Sprint tickets</h3><span className="hint">Unavailable</span></div><p className="hint">{context.errorMessage ?? 'Tickets unavailable.'}</p></section>;
  const capturedAt = new Date(context.capturedAt);
  const refreshed = capturedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const refreshedTitle = capturedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const groups = groupStandupTickets(context.tickets, entries);
  return <section className="standup-tickets" aria-live="polite" aria-busy={refreshing}><div className="standup-ticket-heading"><h3>Sprint tickets</h3>{refreshing ? <span className="standup-ticket-loading"><span className="standup-spinner" aria-hidden="true" />Refreshing</span> : <time className="standup-ticket-freshness" dateTime={context.capturedAt} title={refreshedTitle}>Updated {refreshed}</time>}</div>{context.freshness === 'stale' && <p className="hint">Showing the last saved tickets; refresh failed.</p>}{groups.length ? <div className="standup-ticket-groups">{groups.map((group) => {
    const tone = standupTicketGroupTone(group.tickets);
    const headingId = `standup-ticket-group-${group.identity.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    return <section className={`standup-ticket-group tone-${tone}`} key={group.identity} aria-labelledby={headingId}><h4 id={headingId}><span className="standup-ticket-status-marker" aria-hidden="true" /><span>{group.displayName}</span><span className="badge" aria-label={`${group.tickets.length} tickets`}>{group.tickets.length}</span></h4><ul className="standup-ticket-list">{group.tickets.map((ticket) => <li className="standup-ticket" key={ticket.key}>{ticket.url ? <a href={ticket.url} target="_blank" rel="noreferrer" aria-label={`${ticket.key}, opens in a new tab`}>{ticket.key}<span className="standup-ticket-external" aria-hidden="true">↗</span></a> : <strong>{ticket.key}</strong>}<span className="standup-ticket-summary" title={ticket.summary}>{ticket.summary}</span></li>)}</ul></section>;
  })}</div> : <p className="hint">No tickets in this sprint.</p>}</section>;
}

function PostStandup({ dataset, aggregate, onChange, intake, onSync }: { dataset: DomainDataset; aggregate: api.StandupAggregate; onChange: (value: api.StandupAggregate) => void; intake: { context: StandupIntakeContext | null; refreshing: boolean; message: string | null }; onSync: () => void }) {
  const [selected, setSelected] = useState<IntakeRequest | null>(null);
  const [loggedKeys, setLoggedKeys] = useState<Set<string>>(() => new Set());
  const viewState = intake.context ? { ...intake, context: { ...intake.context, requests: intake.context.requests.map((item) => loggedKeys.has(item.key) ? { ...item, awarenessLogged: true } : item) } } : intake;
  return <div className="post-standup-layout"><div className="post-standup-notes"><Notes dataset={dataset} aggregate={aggregate} onChange={onChange} /></div><StandupIntakeRequests sessionId={aggregate.session.id} state={viewState} onSync={onSync} onLog={setSelected} />{selected && <IntakeAwarenessModal sessionId={aggregate.session.id} standupDate={aggregate.session.date} request={selected} onClose={() => setSelected(null)} onSaved={() => { setLoggedKeys((keys) => new Set(keys).add(selected.key)); setSelected(null); }} />}</div>;
}

function StandupIntakeRequests({ sessionId, state, onSync, onLog }: { sessionId: string; state: { context: StandupIntakeContext | null; refreshing: boolean; message: string | null }; onSync: () => void; onLog: (request: IntakeRequest) => void }) {
  const context = state.context;
  const updated = context ? new Date(context.capturedAt) : null;
  return <section className="standup-intake" aria-labelledby={`intake-requests-${sessionId}`} aria-busy={state.refreshing}>
    <div className="standup-intake-heading">
      <div><h3 id={`intake-requests-${sessionId}`}>Intake requests</h3>{context && <p className="hint"><time dateTime={context.capturedAt}>Updated {updated?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>{context.freshness === 'stale' ? ' · Showing saved requests' : ''}</p>}</div>
      {context && <span className="badge" aria-label={`${context.requests.length} intake requests`}>{context.requests.length}</span>}
      <button type="button" className="btn" aria-label="Sync intake requests" disabled={state.refreshing} onClick={onSync}>{state.refreshing ? 'Syncing…' : 'Sync'}</button>
    </div>
    <div className="sr-only" aria-live="polite">{state.message}</div>
    {!context ? <p className="hint">{state.refreshing ? 'Refreshing current intake requests…' : state.message ?? 'Intake requests are unavailable. Sync to retry.'}</p> : context.freshness === 'unavailable' ? <p className="hint">{context.errorMessage ?? 'Intake requests are unavailable. Sync to retry.'}</p> : context.requests.length === 0 ? <p className="hint">No current intake requests.</p> : <ul className="standup-intake-list">{context.requests.map((request) => <li className="standup-intake-row" key={request.key}><div><div className="standup-intake-title">{request.url ? <a href={request.url} target="_blank" rel="noreferrer" aria-label={`${request.key}, opens in a new tab`}>{request.key} ↗</a> : <strong>{request.key}</strong>}<span>{request.summary}</span></div><p>{request.status} · {request.assigneeName ?? 'Unassigned'}</p></div>{request.awarenessLogged ? <span className="standup-intake-logged">Logged</span> : <button type="button" className="link-btn" aria-label={`Log incoming request ${request.key}`} onClick={() => onLog(request)}>Log incoming request</button>}</li>)}</ul>}
  </section>;
}

function IntakeAwarenessModal({ sessionId, standupDate, request, onClose, onSaved }: { sessionId: string; standupDate: string; request: IntakeRequest; onClose: () => void; onSaved: () => void }) {
  const [awareDate, setAwareDate] = useState(standupDate); const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null); const [notes, setNotes] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const save = async () => { if (!confidence || !/^\d{4}-\d{2}-\d{2}$/.test(awareDate)) return; setSaving(true); setError(null); try { await api.createIntakeAwareness(sessionId, request.key, { awareDate, dateConfidence: confidence, notes }); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save intake log.'); } finally { setSaving(false); } };
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [onClose]);
  return createPortal(<div className="modal-backdrop intake-awareness-backdrop" role="presentation"><section className="modal intake-awareness-modal" role="dialog" aria-modal="true" aria-labelledby="intake-awareness-title"><div className="modal-heading"><div><h2 id="intake-awareness-title">Log incoming request · {request.key}</h2><p className="hint">Record when the team first became aware of this request.</p></div><button type="button" className="modal-close" aria-label="Close log incoming request" onClick={onClose}>×</button></div><label className="control"><span>Date we were made aware</span><DatePicker value={awareDate} onChange={setAwareDate} ariaLabel="Date we were made aware" /></label><fieldset className="intake-confidence"><legend>Confidence in this date</legend><div role="radiogroup" aria-label="Confidence in this date">{(['high', 'medium', 'low'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={confidence === value} className={confidence === value ? 'is-selected' : ''} onClick={() => setConfidence(value)}>{value.toUpperCase()}</button>)}</div></fieldset><label className="control"><span>Other notes <em>(optional)</em></span><textarea maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <p className="config-error" role="alert">{error}</p>}<footer className="modal-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!confidence || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save log'}</button></footer></section></div>, document.body);
}

function RequiredPeople({ dataset, aggregate }: { dataset: DomainDataset; aggregate: api.StandupAggregate }) {
  const required = useMemo(() => deriveStandupRequiredPeople(aggregate.notes, aggregate.participants, dataset.members), [aggregate.notes, aggregate.participants, dataset.members]);
  const colors = useMemo(() => memberColorMap(dataset.members), [dataset.members]);
  const headingId = `standup-required-people-${aggregate.session.id}`;
  const audienceCount = required.people.length + (required.allTeamNoteCount ? 1 : 0);
  return <section className="standup-required-people" aria-labelledby={headingId} data-testid="standup-required-people">
    <div className="standup-required-people-heading"><span className="standup-required-people-icon" aria-hidden="true"><Users /></span><div><h3 id={headingId}>Required people</h3><p>People with an open follow-up in this standup.</p></div><span className="badge" aria-label={`${audienceCount} ${audienceCount === 1 ? 'required audience' : 'required audiences'}`}>{audienceCount}</span></div>
    {audienceCount ? <ul className="standup-required-people-list">{required.allTeamNoteCount > 0 && <li className="standup-required-person is-all-team"><span className="standup-required-team-icon" aria-hidden="true"><Users /></span><span><strong>All team</strong><small>{required.allTeamNoteCount} {required.allTeamNoteCount === 1 ? 'follow-up' : 'follow-ups'}</small></span></li>}{required.people.map((person) => <li className="standup-required-person" key={person.id}><MemberAvatar name={person.name} color={colorFor(colors, person.id)} size={30} avatarUrl={person.avatarUrl} /><span><strong>{person.name}</strong><small>{person.noteCount} {person.noteCount === 1 ? 'follow-up' : 'follow-ups'}</small></span></li>)}</ul> : <p className="standup-required-people-empty">No one is required — all follow-ups are complete or deferred.</p>}
  </section>;
}

function Notes({ dataset, aggregate, onChange, compact = false }: { dataset: DomainDataset; aggregate: api.StandupAggregate; onChange: (value: api.StandupAggregate) => void; compact?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [reorderStatus, setReorderStatus] = useState('');
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const draggedNoteRef = useRef<string | null>(null);
  const dropTargetRef = useRef<{ id: string; after: boolean } | null>(null);
  const editable = aggregate.session.status !== 'completed';
  const mutate = async (action: () => Promise<api.StandupAggregate>) => { try { onChange(await action()); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update note.'); } };
  const move = (id: string, direction: number) => { const ids = aggregate.notes.map((note) => note.id); const from = ids.indexOf(id); const to = from + direction; if (to < 0 || to >= ids.length) return; [ids[from], ids[to]] = [ids[to]!, ids[from]!]; void mutate(() => api.reorderStandupNotes(aggregate.session.id, ids, aggregate.session.revision)); };
  const keyboardMove = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string, index: number) => { const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0; if (!direction) return; event.preventDefault(); const target = index + direction; if (target < 0 || target >= aggregate.notes.length) { setReorderStatus(`Note is already ${direction < 0 ? 'first' : 'last'}.`); return; } move(id, direction); setReorderStatus(`Moved note to position ${target + 1} of ${aggregate.notes.length}.`); };
  const finishDrag = () => { draggedNoteRef.current = null; dropTargetRef.current = null; setDraggedNoteId(null); setDropTarget(null); };
  const dragStart = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => { event.preventDefault(); draggedNoteRef.current = id; setDraggedNoteId(id); event.currentTarget.setPointerCapture(event.pointerId); };
  useEffect(() => {
    if (!draggedNoteId) return;
    const pointerMove = (event: PointerEvent) => {
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-standup-note-id]');
      const id = row?.dataset.standupNoteId;
      if (!id || id === draggedNoteRef.current) { dropTargetRef.current = null; setDropTarget(null); return; }
      const bounds = row.getBoundingClientRect(); const next = { id, after: event.clientY >= bounds.top + bounds.height / 2 };
      if (dropTargetRef.current?.id === next.id && dropTargetRef.current.after === next.after) return;
      dropTargetRef.current = next; setDropTarget(next);
    };
    const pointerUp = () => {
      const draggedId = draggedNoteRef.current; const target = dropTargetRef.current;
      if (draggedId && target) { const ids = aggregate.notes.map((note) => note.id); const from = ids.indexOf(draggedId); let insertion = ids.indexOf(target.id) + (target.after ? 1 : 0); const next = [...ids]; next.splice(from, 1); if (from < insertion) insertion -= 1; next.splice(insertion, 0, draggedId); if (next.some((noteId, index) => noteId !== ids[index])) void mutate(() => api.reorderStandupNotes(aggregate.session.id, next, aggregate.session.revision)); }
      finishDrag();
    };
    window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', finishDrag);
    return () => { window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', finishDrag); };
  }, [aggregate, draggedNoteId]);
  const projection = !compact && aggregate.session.status === 'post_standup';
  return <section className={`standup-notes${compact ? ' compact' : ''}${projection ? ' is-projection' : ''}`}>
    <div className="standup-notes-heading"><h3>Post-standup notes</h3><span className="badge" aria-label={`${aggregate.notes.length} ${aggregate.notes.length === 1 ? 'note' : 'notes'}`}>{aggregate.notes.length}</span></div>
    {projection && <RequiredPeople dataset={dataset} aggregate={aggregate} />}
    {aggregate.notes.length > 0 && <ol className="standup-note-list" data-testid={compact ? 'standup-compact-note-list' : undefined}>{aggregate.notes.map((note, index) => {
      const audience = note.allTeam ? 'All team' : note.mentions.map((mention) => mention.label).join(', ') || 'No audience';
      const completed = note.state === 'completed';
      const isDropTarget = dropTarget?.id === note.id;
      const dropPosition = dropTarget?.after ? 'after' : 'before';
      return <li className={`standup-note${completed ? ' is-completed' : ''}${!editable ? ' is-readonly' : ''}${draggedNoteId === note.id ? ' is-dragging' : ''}${isDropTarget ? ` drop-${dropPosition}` : ''}`} key={note.id} data-standup-note-id={note.id}>
        <span className="standup-note-position" aria-hidden="true">{index + 1}</span>
        {editable && <button type="button" className="standup-note-drag-handle" aria-label="Reorder note. Drag or use Arrow Up and Arrow Down." aria-keyshortcuts="ArrowUp ArrowDown" title="Drag to reorder; use Arrow Up or Arrow Down when focused" onPointerDown={(event) => dragStart(event, note.id)} onKeyDown={(event) => keyboardMove(event, note.id, index)}>⠿</button>}
        <label className="standup-note-toggle"><input type="checkbox" checked={completed} disabled={aggregate.session.status === 'completed'} onChange={() => void mutate(() => api.setStandupNoteState(aggregate.session.id, note.id, completed ? 'open' : 'completed', aggregate.session.revision))} /><span className="sr-only">Mark {note.body} as {completed ? 'open' : 'completed'}</span></label>
        <div className="standup-note-content"><span className="standup-note-body">{note.body}</span><div className="standup-note-lower"><span className="standup-note-meta"><span>For {audience}</span>{note.sourceSessionDate && <span>Carried from {note.sourceSessionDate}</span>}{note.state === 'deferred' && <span>Deferred to next standup</span>}</span>{editable && <span className="standup-note-actions"><button type="button" className="link-btn" onClick={() => void mutate(() => api.setStandupNoteState(aggregate.session.id, note.id, note.state === 'deferred' ? 'open' : 'deferred', aggregate.session.revision))}>{note.state === 'deferred' ? 'Reopen' : 'Defer'}</button><button type="button" className="link-btn danger" onClick={() => void mutate(() => api.deleteStandupNote(aggregate.session.id, note.id, aggregate.session.revision))}>Delete</button></span>}</div></div>
        {isDropTarget && <span className={`standup-note-drop-preview ${dropPosition}`} aria-hidden="true">Drop note here</span>}
      </li>;
    })}</ol>}
    <div className="sr-only" aria-live="polite">{reorderStatus}</div>
    {aggregate.session.status !== 'completed' && <StandupNoteComposer dataset={dataset} teamId={aggregate.session.teamId} sessionId={aggregate.session.id} expectedRevision={aggregate.session.revision} compact={compact} onSave={async (body, audience, sessionId, expectedRevision) => onChange(await api.createStandupNote(sessionId, body, audience, expectedRevision))} />}
    {error && <p className="config-error" role="alert">{error}</p>}
  </section>;
}
