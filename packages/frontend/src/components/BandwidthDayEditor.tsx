import { useEffect, useMemo, useState } from 'react';
import type { BandwidthCheckIn, BandwidthDay, BandwidthFeeling, TeamMember } from '@ecp/shared';
import * as api from '../data/api';
import { formatDate } from '../lib/format';
import { bandwidthDayDraftIsDirty, bandwidthDayPatchFrom, bandwidthDraftEntry, bandwidthDraftFrom, type BandwidthDraft } from '../lib/bandwidthDayDraft';
import { MemberAvatar } from './MemberAvatar';

const FEELINGS: Array<{ value: BandwidthFeeling; label: string; description: string }> = [
  { value: 'red', label: 'Red', description: 'Drowning' },
  { value: 'yellow', label: 'Yellow', description: 'Managing overload' },
  { value: 'green', label: 'Green', description: 'Sustainable load' },
  { value: 'purple', label: 'Purple', description: 'Not enough work' },
];

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

interface BandwidthDayEditorProps {
  teamId: string;
  date: string;
  members: TeamMember[];
  editable: boolean;
  initialCheckIns: BandwidthCheckIn[];
  colors: Map<string, string>;
  onClose: () => void;
  onSaved: (day: BandwidthDay) => void;
}

/** Focused editor for manually backfilling a session-free historical bandwidth day. */
export function BandwidthDayEditor({ teamId, date, members, editable, initialCheckIns, colors, onClose, onSaved }: BandwidthDayEditorProps) {
  const [day, setDay] = useState<BandwidthDay>({ teamId, date, checkIns: initialCheckIns, standup: null });
  const [draft, setDraft] = useState<BandwidthDraft>(() => bandwidthDraftFrom(initialCheckIns));
  const [loading, setLoading] = useState(editable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set(initialCheckIns.filter((entry) => entry.note).map((entry) => entry.memberId)));

  useEffect(() => {
    const fallback: BandwidthDay = { teamId, date, checkIns: initialCheckIns, standup: null };
    setDay(fallback); setDraft(bandwidthDraftFrom(initialCheckIns)); setNotesOpen(new Set(initialCheckIns.filter((entry) => entry.note).map((entry) => entry.memberId))); setError(null);
    if (!editable) { setLoading(false); return; }
    let current = true;
    setLoading(true);
    api.getBandwidthDay(teamId, date)
      .then((result) => { if (current) { setDay(result); setDraft(bandwidthDraftFrom(result.checkIns)); setNotesOpen(new Set(result.checkIns.filter((entry) => entry.note).map((entry) => entry.memberId))); } })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [date, editable, initialCheckIns, teamId]);

  const today = localToday();
  const isPast = date < today;
  const canEdit = editable && isPast && !day.standup && !loading;
  const { patch, error: draftError } = bandwidthDayPatchFrom(day.checkIns, draft);
  const dirty = bandwidthDayDraftIsDirty(day.checkIns, draft);
  const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);
  const inactiveMembers = useMemo(() => members.filter((member) => !member.active && day.checkIns.some((entry) => entry.memberId === member.id)), [day.checkIns, members]);
  const rows = [...activeMembers, ...inactiveMembers];
  const reported = day.checkIns.length;

  const close = () => {
    if (busy) return;
    if (dirty && !window.confirm('Discard unsaved bandwidth changes?')) return;
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const update = (memberId: string, change: Partial<BandwidthDraft[string]>) => {
    setDraft((current) => ({ ...current, [memberId]: { ...bandwidthDraftEntry(current, memberId), ...change } }));
  };
  const clear = (memberId: string) => update(memberId, { feeling: null, note: '' });
  const toggleNote = (memberId: string) => setNotesOpen((current) => {
    const next = new Set(current);
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
    return next;
  });
  const retry = () => {
    setLoading(true); setError(null);
    api.getBandwidthDay(teamId, date)
      .then((result) => { setDay(result); setDraft(bandwidthDraftFrom(result.checkIns)); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  };
  const save = async () => {
    if (!canEdit || draftError || !dirty) return;
    setBusy(true); setError(null);
    try {
      const saved = await api.patchBandwidthDay(teamId, date, patch);
      onSaved(saved);
      onClose();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      if (message.includes('Standup-managed') || message.includes('Standup-owned')) retry();
    } finally { setBusy(false); }
  };

  const stateCopy = !editable
    ? 'Sample data is read-only.'
    : day.standup
      ? `Captured in Standup (${day.standup.status.replace('_', ' ')}). Standup-owned history is read-only here.`
      : date === today
        ? 'Use Standup to collect today’s check-ins.'
        : date > today
          ? 'Future dates are unavailable.'
          : 'Add or correct manual historical check-ins.';

  return <div className="modal-backdrop bandwidth-day-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal bandwidth-day-editor" role="dialog" aria-modal="true" aria-labelledby="bandwidth-day-editor-title">
      <header className="modal-heading">
        <div><h2 id="bandwidth-day-editor-title">Bandwidth check-ins — {formatDate(date)}</h2><p className="hint">{stateCopy}</p></div>
        <button className="modal-close" type="button" aria-label="Close bandwidth check-ins" disabled={busy} onClick={close}>×</button>
      </header>
      {loading ? <p className="hint bandwidth-day-loading">Loading day details…</p> : <>
        <p className="bandwidth-day-coverage">{reported} of {activeMembers.length} active members reported</p>
        {rows.length ? <div className="bandwidth-day-members">
          {activeMembers.map((member) => <BandwidthMemberRow key={member.id} member={member} draft={bandwidthDraftEntry(draft, member.id)} canEdit={canEdit} noteOpen={notesOpen.has(member.id)} color={colors.get(member.id) ?? '#7182a3'} onUpdate={(change) => update(member.id, change)} onClear={() => clear(member.id)} onToggleNote={() => toggleNote(member.id)} />)}
          {inactiveMembers.length > 0 && <details className="bandwidth-inactive-members"><summary>Inactive members ({inactiveMembers.length})</summary>{inactiveMembers.map((member) => <BandwidthMemberRow key={member.id} member={member} draft={bandwidthDraftEntry(draft, member.id)} canEdit={canEdit} noteOpen={notesOpen.has(member.id)} color={colors.get(member.id) ?? '#7182a3'} onUpdate={(change) => update(member.id, change)} onClear={() => clear(member.id)} onToggleNote={() => toggleNote(member.id)} />)}</details>}
        </div> : <p className="hint">No team members are available for this date.</p>}
      </>}
      {(error || draftError) && <p className="config-error modal-error" role="alert">⚠ {error ?? draftError}</p>}
      <footer className="modal-actions"><button className="btn" type="button" disabled={busy} onClick={close}>Cancel</button>{error && editable && !loading && <button className="btn" type="button" disabled={busy} onClick={retry}>Retry</button>}{canEdit && <button className="btn primary" type="button" disabled={busy || !dirty || Boolean(draftError)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>}</footer>
    </section>
  </div>;
}

function BandwidthMemberRow({ member, draft, canEdit, noteOpen, color, onUpdate, onClear, onToggleNote }: {
  member: TeamMember;
  draft: BandwidthDraft[string];
  canEdit: boolean;
  noteOpen: boolean;
  color: string;
  onUpdate: (change: Partial<BandwidthDraft[string]>) => void;
  onClear: () => void;
  onToggleNote: () => void;
}) {
  const groupName = `bandwidth-feeling-${member.id}`;
  return <article className="bandwidth-member-row">
    <div className="bandwidth-member-heading"><MemberAvatar name={member.name} color={color} size={24} avatarUrl={member.avatarUrl} /><strong>{member.name}</strong>{!member.active && <span className="bandwidth-inactive-badge">Inactive</span>}</div>
    <div className="bandwidth-feeling-options" role="radiogroup" aria-label={`${member.name} bandwidth feeling`}>
      {FEELINGS.map((feeling) => <label key={feeling.value} className={`bandwidth-feeling-option feeling-${feeling.value}${draft.feeling === feeling.value ? ' is-selected' : ''}`} title={feeling.description}>
        <input type="radio" name={groupName} checked={draft.feeling === feeling.value} disabled={!canEdit} onChange={() => onUpdate({ feeling: feeling.value })} />
        <span>{feeling.label}</span>
      </label>)}
    </div>
    <div className="bandwidth-member-actions"><button type="button" className="link-btn" disabled={!canEdit} onClick={onToggleNote}>{noteOpen ? 'Hide note' : draft.note ? 'Edit note' : 'Add note'}</button>{draft.feeling && <button type="button" className="link-btn danger" disabled={!canEdit} onClick={onClear}>Clear response</button>}</div>
    {noteOpen && <label className="control bandwidth-member-note"><span>Note for {member.name} (optional)</span><textarea value={draft.note} disabled={!canEdit} maxLength={2000} placeholder="Optional context" onChange={(event) => onUpdate({ note: event.target.value })} /></label>}
  </article>;
}
