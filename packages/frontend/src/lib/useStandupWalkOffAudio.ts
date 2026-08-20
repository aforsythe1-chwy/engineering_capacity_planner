import { useEffect, useRef, useState } from 'react';
import { resolveStandupAudioTrack, type TeamStandupAudioSettings } from '@ecp/shared';
import { standupAudioContentUrl } from '../data/api';

const gains = [0, .16, .32, .55, .8];
export function useStandupWalkOffAudio({ settings, memberId, heat, paused, active }: { settings: TeamStandupAudioSettings | null; memberId: string | undefined; heat: number; paused: boolean; active: boolean }) {
  const [enabled, setEnabled] = useState(true); const [muted, setMuted] = useState(false); const [status, setStatus] = useState<'unavailable' | 'disabled' | 'ready' | 'playing' | 'paused' | 'muted' | 'blocked' | 'error'>('unavailable');
  const audio = useRef<HTMLAudioElement | null>(null); const context = useRef<AudioContext | null>(null); const gain = useRef<GainNode | null>(null); const trackId = settings && memberId ? resolveStandupAudioTrack(settings, memberId) : null;
  const stop = (rewind = true) => { const element = audio.current; if (!element) return; element.pause(); if (rewind) element.currentTime = 0; gain.current?.gain.setValueAtTime(0, context.current?.currentTime ?? 0); };
  const enable = async () => { if (!trackId) return; try { if (!context.current) { context.current = new AudioContext(); audio.current = new Audio(standupAudioContentUrl(trackId)); audio.current.loop = true; gain.current = context.current.createGain(); context.current.createMediaElementSource(audio.current).connect(gain.current).connect(context.current.destination); } await context.current.resume(); setEnabled(true); setStatus('ready'); } catch { setStatus('blocked'); } };
  useEffect(() => { setEnabled(true); setMuted(false); stop(); if (audio.current) { audio.current.src = trackId ? standupAudioContentUrl(trackId) : ''; audio.current.load(); } setStatus(trackId && active ? 'ready' : 'unavailable'); }, [trackId, memberId, active]);
  useEffect(() => { if (trackId && active && !audio.current) void enable(); }, [trackId, active]);
  useEffect(() => { if (!enabled || !audio.current || !context.current || !gain.current) return; const target = !active || paused || muted ? 0 : gains[heat] ?? 0; gain.current.gain.cancelScheduledValues(context.current.currentTime); gain.current.gain.linearRampToValueAtTime(target, context.current.currentTime + .35); if (!active || heat === 0) { stop(true); setStatus('ready'); return; } if (paused) { audio.current.pause(); setStatus('paused'); return; } if (muted) { setStatus('muted'); return; } void audio.current.play().then(() => setStatus('playing')).catch(() => setStatus('blocked')); }, [active, enabled, heat, muted, paused]);
  useEffect(() => () => { stop(); gain.current?.disconnect(); void context.current?.close(); }, []);
  return { enabled, muted, status, enable: () => void enable(), retry: () => void enable(), toggleMute: () => setMuted((value) => !value), available: Boolean(trackId && active) };
}
