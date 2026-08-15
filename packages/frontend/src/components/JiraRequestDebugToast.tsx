import { useEffect, useRef, useState } from 'react';
import * as api from '../data/api';

/** Local-only observability for Jira traffic; enabled by ECP_JIRA_REQUEST_DEBUG. */
export function JiraRequestDebugToast({ enabled }: { enabled: boolean }) {
  const [event, setEvent] = useState<api.JiraCacheEvent | null>(null);
  const last = useRef('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const poll = async () => {
      try {
        const result = await api.getJiraCacheEvents();
        if (!active || !result.enabled) return;
        const latest = result.events.at(-1);
        if (!latest) return;
        const key = `${latest.at}:${latest.operation}:${latest.outcome}`;
        if (key !== last.current) { last.current = key; setEvent(latest); }
      } catch { /* Backend may be unavailable or debug is intentionally disabled. */ }
    };
    void poll(); const interval = window.setInterval(() => void poll(), 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [enabled]);
  useEffect(() => { if (!event) return; const timeout = window.setTimeout(() => setEvent(null), 3500); return () => window.clearTimeout(timeout); }, [event]);
  if (!enabled || !event) return null;
  const label = event.outcome === 'network' ? 'Jira network request' : event.outcome === 'cache-hit' ? 'Jira cache hit' : event.outcome === 'coalesced' ? 'Jira request joined' : 'Jira request failed';
  return <div className={`jira-debug-toast ${event.outcome}`} role="status" data-testid="jira-request-debug-toast"><strong>{label}</strong><span>{event.operation}{event.durationMs != null ? ` · ${event.durationMs} ms` : ''}</span></div>;
}
