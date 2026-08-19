import { useEffect, useRef, useState } from 'react';
import { formatStandupElapsed } from '../lib/standupTimer';

export function StandupSpeakerTimer({ timerKey, thresholdSeconds, onOvertimeChange }: { timerKey: string; thresholdSeconds: number; onOvertimeChange: (overTime: boolean, paused: boolean, heat: number) => void }) {
  const [elapsed, setElapsed] = useState(0); const [paused, setPaused] = useState(false); const startedAt = useRef(performance.now()); const accumulated = useRef(0);
  useEffect(() => { accumulated.current = 0; startedAt.current = performance.now(); setElapsed(0); setPaused(false); }, [timerKey]);
  useEffect(() => { if (paused) return; const tick = () => setElapsed(accumulated.current + performance.now() - startedAt.current); tick(); const id = window.setInterval(tick, 250); return () => window.clearInterval(id); }, [paused, timerKey]);
  const overTime = elapsed >= thresholdSeconds * 1000;
  const heat = overTime ? Math.min(4, 1 + Math.floor((elapsed - thresholdSeconds * 1000) / 30_000)) : 0;
  useEffect(() => { onOvertimeChange(overTime, paused, heat); }, [overTime, paused, heat, onOvertimeChange]);
  const toggle = () => { if (paused) { startedAt.current = performance.now(); setPaused(false); } else { accumulated.current += performance.now() - startedAt.current; setElapsed(accumulated.current); setPaused(true); } };
  const reset = () => { accumulated.current = 0; startedAt.current = performance.now(); setElapsed(0); setPaused(false); };
  return <div className="standup-speaker-timer"><time dateTime={`PT${Math.floor(elapsed / 1000)}S`}>{formatStandupElapsed(elapsed)}</time>{overTime && <span className={`standup-overtime heat-${heat}`} role="status">Over time</span>}<button type="button" className="link-btn" onClick={toggle} aria-label={paused ? 'Resume speaker timer' : 'Pause speaker timer'}>{paused ? 'Resume' : 'Pause'}</button><button type="button" className="link-btn" onClick={reset} aria-label="Reset speaker timer">Reset</button></div>;
}
