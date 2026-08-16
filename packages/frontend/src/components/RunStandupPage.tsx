import { useEffect, useMemo, useRef, useState } from 'react';
import { effectivePortfolioEpic, epicOwnerId, epicSmes, globalStringSetting, SETTING_KEYS, type BandwidthCheckIn, type BandwidthFeeling, type DomainDataset, type StandupMemberTicketContext, type StandupParticipant } from '@ecp/shared';
import * as api from '../data/api';
import { boardPresentation, groupStandupTickets, parsePresentation, standupTicketGroupTone } from '../lib/standupStatusPresentation';

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
  const open = async () => { if (!team || !editable) return; setError(null); try { setAggregate(await api.startStandup(team.id, localToday())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  if (!team) return <main className="team-page"><section className="panel">No team is configured yet.</section></main>;
  return <main className="team-page" data-testid="standup-page"><section className="panel team-header standup-launch"><div><h2>Standup</h2><p className="hint">Review the current sprint, capture today’s bandwidth, and record team follow-ups.</p></div><div className="team-controls">{dataset.teams.length > 1 && <label className="control"><span>Team</span><select value={team.id} onChange={(e) => onTeamChange(e.target.value)}>{dataset.teams.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>}<button ref={launch} className="btn primary" disabled={!editable} onClick={() => { void open(); }}>Start Standup</button></div></section>{!editable && <div className="panel config-notice">Bundled sample data is read-only. Start the backend to facilitate a standup.</div>}{error && <div className="panel config-error" role="alert">⚠ {error}</div>}{aggregate && <StandupModal dataset={dataset} aggregate={aggregate} onChange={setAggregate} onClose={() => { setAggregate(null); launch.current?.focus(); }} onError={setError} />}</main>;
}

function StandupModal({ dataset, aggregate, onChange, onClose, onError }: { dataset: DomainDataset; aggregate: api.StandupAggregate; onChange: (value: api.StandupAggregate) => void; onClose: () => void; onError: (value: string | null) => void }) {
  useEffect(() => { const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previousOverflow; }; }, []);
  const [ticketStates, setTicketStates] = useState<Record<string, { context: StandupMemberTicketContext | null; refreshing: boolean }>>({});
  const snapshotRequests = useRef(new Map<string, Promise<StandupMemberTicketContext | null>>()); const refreshRequests = useRef(new Map<string, Promise<StandupMemberTicketContext>>());
  const current = aggregate.participants.find((p) => p.disposition === 'pending'); const pending = aggregate.participants.filter((p) => p.disposition === 'pending'); const done = aggregate.participants.filter((p) => p.disposition !== 'pending').length;
  const currentMemberId = pending[0]?.memberId; const nextMemberId = pending[1]?.memberId;
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
  const resolve = async (disposition: 'completed' | 'skipped') => { if (!current) return; try { onChange(await api.resolveStandupParticipant(aggregate.session.id, current.memberId, disposition, aggregate.session.revision)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } };
  const finish = async () => { try { onChange(await api.finishStandup(aggregate.session.id, aggregate.session.revision)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } };
  return <div className="modal-backdrop standup-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal standup-modal" role="dialog" aria-modal="true" aria-labelledby="standup-title"><header className="modal-heading"><div><h2 id="standup-title">{aggregate.session.status === 'post_standup' ? 'Post-standup notes' : 'Standup'}</h2><p className="hint">{aggregate.session.sprintName ?? 'Sprint unavailable'} · {aggregate.session.date} · {aggregate.session.status === 'active' ? `${done} of ${aggregate.participants.length}` : aggregate.session.status === 'completed' ? 'Completed' : 'Post-standup'}</p></div><button className="modal-close" aria-label="Close standup" onClick={onClose}>×</button></header>{aggregate.session.status === 'active' && current ? <TeamRound dataset={dataset} aggregate={aggregate} participant={current} ticketContext={ticketStates[current.memberId]?.context ?? null} ticketRefreshing={ticketStates[current.memberId]?.refreshing ?? false} onChange={onChange} /> : <Notes aggregate={aggregate} onChange={onChange} />}{aggregate.session.status === 'active' && current && <footer className="modal-actions"><button className="btn" onClick={() => void resolve('skipped')}>Skip</button><button className="btn primary" onClick={() => void resolve('completed')}>Next</button></footer>}{aggregate.session.status === 'post_standup' && <footer className="modal-actions"><button className="btn primary" onClick={() => void finish()}>Finish Standup</button></footer>}</section></div>;
}

function TeamRound({ dataset, aggregate, participant, ticketContext, ticketRefreshing, onChange }: { dataset: DomainDataset; aggregate: api.StandupAggregate; participant: StandupParticipant; ticketContext: StandupMemberTicketContext | null; ticketRefreshing: boolean; onChange: (value: api.StandupAggregate) => void }) {
  const [checkIns, setCheckIns] = useState<BandwidthCheckIn[]>(dataset.bandwidthCheckIns ?? []);
  const entry = checkIns.find((item) => item.memberId === participant.memberId && item.date === aggregate.session.date); const epics = useMemo(() => dataset.epics.filter((epic) => epic.teamId === aggregate.session.teamId && effectivePortfolioEpic(dataset, epic.key).tracked).map((epic) => { const ownerId = epicOwnerId(dataset, epic.key); const role: keyof typeof epicRoleOrder = ownerId === participant.memberId ? 'owner' : epicSmes(dataset, epic.key).some((sme) => sme.memberId === participant.memberId) ? 'sme' : 'other'; return { epic, owner: dataset.members.find((member) => member.id === ownerId), role }; }).sort((a, b) => epicRoleOrder[a.role] - epicRoleOrder[b.role] || a.epic.key.localeCompare(b.epic.key)), [dataset, aggregate.session.teamId, participant.memberId]);
  const presentation = boardPresentation(parsePresentation(dataset.settings.find((row) => row.scope === 'global' && row.key === SETTING_KEYS.STANDUP_STATUS_PRESENTATION)?.value), globalStringSetting(dataset.settings, SETTING_KEYS.JIRA_BOARD_ID));
  return <div className="standup-grid"><aside><Notes aggregate={aggregate} onChange={onChange} compact /><h3>Current epics</h3>{epics.length ? <div className="standup-epic-list">{epics.map(({ epic, owner, role }) => <article className={`standup-epic-card is-${role}`} key={epic.key}><div className="standup-epic-heading"><strong>{epic.key}</strong>{role === 'owner' && <span className="standup-leader" aria-label="You are the epic leader"><span aria-hidden="true">♛</span> Leader</span>}{role === 'sme' && <span className="standup-sme">SME</span>}</div><span>{epic.title}</span><small>{role === 'owner' ? 'You own this epic' : role === 'sme' ? 'You are an SME' : owner ? `Owner · ${owner.name}` : 'Unowned'}</small></article>)}</div> : <p className="hint">No current epics.</p>}</aside><div><h3>{participant.memberName}</h3><p className="hint">Participant {participant.position + 1} of {aggregate.participants.length}</p><StandupBandwidthCheckIn memberId={participant.memberId} date={aggregate.session.date} entry={entry} onSaved={(saved) => setCheckIns((items) => [...items.filter((item) => item.memberId !== saved.memberId || item.date !== saved.date), saved])} onRemoved={() => setCheckIns((items) => items.filter((item) => item.memberId !== participant.memberId || item.date !== aggregate.session.date))} /><StandupTickets context={ticketContext} refreshing={ticketRefreshing} entries={presentation?.entries} /></div></div>;
}

function StandupBandwidthCheckIn({ memberId, date, entry, onSaved, onRemoved }: { memberId: string; date: string; entry: BandwidthCheckIn | undefined; onSaved: (entry: BandwidthCheckIn) => void; onRemoved: () => void }) {
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

  const save = async (feeling: BandwidthFeeling, note: string) => {
    const sequence = (requestSequence.current.get(editorKey) ?? 0) + 1;
    requestSequence.current.set(editorKey, sequence);
    if (activeKey.current === editorKey) { setSaving(true); setError(null); setRetry(null); }
    try {
      const saved = await api.upsertBandwidthCheckIn(memberId, date, { feeling, note });
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
      await api.deleteBandwidthCheckIn(memberId, date);
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

function Notes({ aggregate, onChange, compact = false }: { aggregate: api.StandupAggregate; onChange: (value: api.StandupAggregate) => void; compact?: boolean }) { const [draft, setDraft] = useState(''); const save = async () => { if (!draft.trim()) return; onChange(await api.createStandupNote(aggregate.session.id, draft, true, [], aggregate.session.revision)); setDraft(''); }; return <section className={compact ? 'standup-notes compact' : 'standup-notes'}><h3>Post-standup notes <span className="hint">{aggregate.notes.length}</span></h3>{aggregate.notes.map((note) => <p className="standup-note" key={note.id}>{note.body} <span className="hint">{note.allTeam ? 'All team' : note.memberIds.join(', ')}</span></p>)}{aggregate.session.status !== 'completed' && <div className="standup-note-add"><input type="text" aria-label="New post-standup note" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add follow-up note" /><button className="btn" onClick={() => void save()}>Add</button></div>}</section>; }
