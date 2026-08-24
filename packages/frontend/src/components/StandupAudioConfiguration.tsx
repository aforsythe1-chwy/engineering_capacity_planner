import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StandupAudioMemberAssignment, StandupAudioTrackSummary, TeamMember, TeamStandupAudioSettings } from '@ecp/shared';
import * as api from '../data/api';
import { Typeahead } from './Typeahead';

export interface TeamStandupAudioController {
  tracks: StandupAudioTrackSummary[];
  settings: TeamStandupAudioSettings | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setDefaultTrack: (trackId: string | null) => Promise<boolean>;
  setMemberAssignment: (memberId: string, assignment: StandupAudioMemberAssignment | null) => Promise<boolean>;
  uploadTrack: (file: File, displayName: string) => Promise<boolean>;
  deleteTrack: (trackId: string) => Promise<boolean>;
  clearError: () => void;
  reportError: (value: string) => void;
}

export function memberSongSummary(settings: TeamStandupAudioSettings | null, tracks: StandupAudioTrackSummary[], memberId: string): string {
  if (!settings) return 'Audio unavailable';
  const assignment = settings.memberAssignments.find((entry) => entry.memberId === memberId);
  const defaultTrack = tracks.find((track) => track.id === settings.defaultTrackId);
  const assignedTrack = tracks.find((track) => track.id === assignment?.trackId);
  if (assignment?.mode === 'off') return 'No song';
  if (assignment?.mode === 'track') return assignedTrack?.displayName ?? 'Missing song';
  return defaultTrack ? `Uses team default: ${defaultTrack.displayName}` : 'No team default';
}

/** Shared team-audio state. The API replaces the complete settings document, so all writes are serialized. */
export function useTeamStandupAudio(teamId: string | null): TeamStandupAudioController {
  const [tracks, setTracks] = useState<StandupAudioTrackSummary[]>([]);
  const [settings, setSettings] = useState<TeamStandupAudioSettings | null>(null);
  const [loading, setLoading] = useState(Boolean(teamId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!teamId) { setTracks([]); setSettings(null); setLoading(false); return; }
    setLoading(true);
    try {
      const [nextTracks, nextSettings] = await Promise.all([api.listStandupAudioTracks(), api.getTeamStandupAudio(teamId)]);
      setTracks(nextTracks);
      setSettings(nextSettings);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load walk-off audio.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { void reload(); }, [reload]);

  const replace = useCallback(async (makeNext: (current: TeamStandupAudioSettings) => Omit<TeamStandupAudioSettings, 'teamId'>): Promise<boolean> => {
    if (!teamId || !settings || busy) return false;
    setBusy(true);
    setError(null);
    try {
      setSettings(await api.saveTeamStandupAudio(teamId, makeNext(settings)));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save audio settings.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, settings, teamId]);

  const setDefaultTrack = useCallback((trackId: string | null) => replace((current) => ({
    defaultTrackId: trackId,
    memberAssignments: current.memberAssignments,
  })), [replace]);

  const setMemberAssignment = useCallback((memberId: string, assignment: StandupAudioMemberAssignment | null) => replace((current) => ({
    defaultTrackId: current.defaultTrackId,
    memberAssignments: assignment
      ? [...current.memberAssignments.filter((entry) => entry.memberId !== memberId), assignment]
      : current.memberAssignments.filter((entry) => entry.memberId !== memberId),
  })), [replace]);

  const uploadTrack = useCallback(async (file: File, displayName: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await api.uploadStandupAudioTrack(file, displayName);
      await reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, reload]);

  const deleteTrack = useCallback(async (trackId: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await api.deleteStandupAudioTrack(trackId);
      await reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete track.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, reload]);

  return { tracks, settings, loading, busy, error, reload, setDefaultTrack, setMemberAssignment, uploadTrack, deleteTrack, clearError: () => setError(null), reportError: setError };
}

export function StandupAudioConfiguration({ audio, disabled, embedded = false }: { audio: TeamStandupAudioController; disabled: boolean; embedded?: boolean }) {
  const title = <div className="section-title"><div><h3>Walk-off audio</h3><span className="hint">MP3s are stored in this shareable database and play only after the facilitator enables audio. Upload only music you are allowed to use.</span></div></div>;
  const content = <>{title}<TrackLibrary audio={audio} disabled={disabled} />{audio.loading && <p className="hint">Loading walk-off audio…</p>}{audio.error && <p className="config-error" role="alert">⚠ {audio.error}</p>}</>;
  return embedded ? <section className="config-subsection standup-audio-config">{content}</section> : <section className="panel standup-audio-config">{content}</section>;
}

function TrackLibrary({ audio, disabled }: { audio: TeamStandupAudioController; disabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const tracks = audio.tracks;
  const defaultText = tracks.find((track) => track.id === audio.settings?.defaultTrackId)?.displayName ?? 'No default song';
  const [defaultInput, setDefaultInput] = useState(defaultText);
  useEffect(() => setDefaultInput(defaultText), [defaultText]);
  useEffect(() => () => { audioElement.current?.pause(); }, []);
  const options = useMemo(() => [{ id: 'none', label: 'No default song' }, ...tracks.map((track) => ({ id: track.id, label: track.displayName, hint: track.originalFilename }))], [tracks]);
  const upload = async () => {
    if (!file) return;
    const saved = await audio.uploadTrack(file, name.trim() || file.name.replace(/\.mp3$/i, ''));
    if (saved) { setFile(null); setName(''); }
  };
  const preview = (track: StandupAudioTrackSummary) => {
    if (playing === track.id) { audioElement.current?.pause(); setPlaying(null); return; }
    audioElement.current?.pause();
    const next = new Audio(api.standupAudioContentUrl(track.id));
    next.volume = .35;
    next.onended = () => setPlaying(null);
    audioElement.current = next;
    void next.play().then(() => setPlaying(track.id)).catch((reason) => audio.reportError(reason instanceof Error ? reason.message : 'Preview could not play.'));
  };
  return <div className="standup-audio-library">
    <label className="control"><span>Team default song</span><Typeahead value={defaultInput} onChange={setDefaultInput} selectedId={audio.settings?.defaultTrackId ?? null} disabled={disabled || audio.busy || !audio.settings} search={async (query) => options.filter((track) => track.label.toLowerCase().includes(query.toLowerCase()))} onSelect={(option) => void audio.setDefaultTrack(option.id === 'none' ? null : option.id)} searchAllOnFocus selectValueOnFocus portalMenu debounceMs={0} showLoading={false} /></label>
    <label className="control"><span>Upload MP3 (12 MiB maximum)</span><input type="file" accept=".mp3,audio/mpeg" disabled={disabled || audio.busy} onChange={(event) => { const next = event.currentTarget.files?.[0] ?? null; setFile(next); setName(next ? next.name.replace(/\.mp3$/i, '') : ''); }} /></label>
    {file && <div className="standup-audio-upload"><input type="text" value={name} aria-label="Track display name" onChange={(event) => setName(event.target.value)} disabled={disabled || audio.busy} /><button type="button" className="btn primary" disabled={disabled || audio.busy} onClick={() => void upload()}>{audio.busy ? 'Uploading…' : 'Upload'}</button></div>}
    <div className="standup-audio-tracks">{tracks.length ? tracks.map((track) => <div className="standup-audio-track" key={track.id}><span><strong>♫ {track.displayName}</strong><small>{track.originalFilename} · {(track.byteLength / 1024 / 1024).toFixed(1)} MiB</small></span><div><button type="button" className="link-btn" onClick={() => preview(track)}>{playing === track.id ? 'Stop' : 'Preview'}</button><button type="button" className="link-btn danger" disabled={disabled || audio.busy} onClick={() => void audio.deleteTrack(track.id)}>Delete</button></div></div>) : <p className="hint">No walk-off songs uploaded yet.</p>}</div>
  </div>;
}

export function MemberSongControl({ member, audio, disabled }: { member: TeamMember; audio: TeamStandupAudioController; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const assignment = audio.settings?.memberAssignments.find((entry) => entry.memberId === member.id);
  const summary = memberSongSummary(audio.settings, audio.tracks, member.id);
  const close = () => { setOpen(false); window.setTimeout(() => opener.current?.focus(), 0); };
  return <div className="member-song-control"><span className="member-song-summary">{summary}</span><button ref={opener} type="button" className="link-btn" disabled={disabled || audio.busy || !audio.settings} onClick={() => setOpen(true)} aria-haspopup="dialog">Edit song</button>{open && <MemberSongModal member={member} assignment={assignment} tracks={audio.tracks} busy={audio.busy} onCancel={close} onSave={async (next) => { if (await audio.setMemberAssignment(member.id, next)) close(); }} />}</div>;
}

function MemberSongModal({ member, assignment, tracks, busy, onCancel, onSave }: { member: TeamMember; assignment?: StandupAudioMemberAssignment; tracks: StandupAudioTrackSummary[]; busy: boolean; onCancel: () => void; onSave: (assignment: StandupAudioMemberAssignment | null) => void }) {
  const [mode, setMode] = useState<'inherit' | 'off' | 'track'>(assignment?.mode ?? 'inherit');
  const [trackId, setTrackId] = useState(assignment?.trackId ?? tracks[0]?.id ?? '');
  const [trackText, setTrackText] = useState(tracks.find((track) => track.id === (assignment?.trackId ?? tracks[0]?.id))?.displayName ?? '');
  const options = useMemo(() => tracks.map((track) => ({ id: track.id, label: track.displayName, hint: track.originalFilename })), [tracks]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="modal member-song-modal" role="dialog" aria-modal="true" aria-labelledby={`member-song-${member.id}`} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}><div className="modal-heading"><div><h2 id={`member-song-${member.id}`}>{member.name}'s walk-off song</h2><p className="hint">Choose the team default, silence, or a specific song.</p></div><button type="button" className="link-btn" onClick={onCancel}>Close</button></div><fieldset className="member-song-options" disabled={busy}><legend>Song preference</legend><label><input type="radio" name={`member-song-${member.id}`} checked={mode === 'inherit'} onChange={() => setMode('inherit')} /> Use team default</label><label><input type="radio" name={`member-song-${member.id}`} checked={mode === 'off'} onChange={() => setMode('off')} /> No song</label><label><input type="radio" name={`member-song-${member.id}`} checked={mode === 'track'} onChange={() => setMode('track')} /> Custom song</label></fieldset>{mode === 'track' && <label className="control"><span>Song</span><Typeahead value={trackText} onChange={setTrackText} selectedId={trackId || null} search={async (query) => options.filter((track) => track.label.toLowerCase().includes(query.toLowerCase()))} onSelect={(option) => { setTrackId(option.id); setTrackText(option.label); }} searchAllOnFocus selectValueOnFocus portalMenu debounceMs={0} showLoading={false} /></label>}<div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="btn primary" disabled={busy || (mode === 'track' && !trackId)} onClick={() => onSave(mode === 'inherit' ? null : { memberId: member.id, mode, trackId: mode === 'track' ? trackId : null })}>{busy ? 'Saving…' : 'Save song'}</button></div></div></div>;
}
