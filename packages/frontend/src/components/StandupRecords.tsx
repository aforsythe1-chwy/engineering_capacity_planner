import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, CircleDashed, Trash2 } from 'lucide-react';
import { parseIso, type StandupSession } from '@ecp/shared';
import { formatDate } from '../lib/format';
import { formatStandupRecordWeek, groupStandupRecordsByWeek, STANDUP_RECORD_WEEKDAYS, standupRecordStatus } from '../lib/standupRecords';

type RecordMenu = { session: StandupSession; x: number; y: number; trigger: HTMLButtonElement };

export function StandupRecords({ sessions, includeWeekends, openingSessionId, deletingSessionId, onOpen, onDelete }: { sessions: readonly StandupSession[]; includeWeekends: boolean; openingSessionId: string | null; deletingSessionId: string | null; onOpen: (sessionId: string) => void; onDelete: (session: StandupSession) => Promise<void> }) {
  const weekdays = includeWeekends ? STANDUP_RECORD_WEEKDAYS : STANDUP_RECORD_WEEKDAYS.slice(0, 5);
  const weeks = groupStandupRecordsByWeek(sessions).map((week) => ({ ...week, days: week.days.slice(0, weekdays.length) })).filter((week) => week.days.some((day) => day.session));
  const [menu, setMenu] = useState<RecordMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(null); menu.trigger.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>, session: StandupSession) => {
    event.preventDefault();
    const x = Math.min(event.clientX, window.innerWidth - 196); const y = Math.min(event.clientY, window.innerHeight - 54);
    setMenu({ session, x: Math.max(8, x), y: Math.max(8, y), trigger: event.currentTarget });
  };
  const deleteFromMenu = async () => { if (!menu) return; const selected = menu; setMenu(null); await onDelete(selected.session); };
  return <section className="panel standup-session-list" aria-labelledby="standup-records-heading">
    <div className="standup-records-heading"><h3 id="standup-records-heading">Standup records</h3><StandupRecordLegend /></div>
    {!weeks.length ? <p className="hint">No saved standups.</p> : <div className="standup-records-scroll" role="region" aria-label="Standup records by week" tabIndex={0}>
      <div className="standup-records-grid" style={{ '--standup-record-day-count': weekdays.length, '--standup-record-min-width': includeWeekends ? '610px' : '462px' } as CSSProperties}>
        <div className="standup-records-weekdays" aria-hidden="true"><span /><>{weekdays.map((day) => <span key={day.short}>{day.short}</span>)}</></div>
        {weeks.map((week) => <div className="standup-records-week" key={week.start} data-testid={`standup-record-week-${week.start}`}>
          <span className="standup-record-week-range">{formatStandupRecordWeek(week.start, week.end)}</span>
          {week.days.map((day) => day.session ? <StandupRecordCard key={day.date} session={day.session} loading={openingSessionId === day.session.id || deletingSessionId === day.session.id} onOpen={onOpen} onContextMenu={openMenu} /> : <span key={day.date} className="standup-record-empty-day" aria-hidden="true" />)}
        </div>)}
      </div>
    </div>}
    {menu && createPortal(<div ref={menuRef} className="standup-record-context-menu" role="menu" aria-label={`Actions for ${formatDate(menu.session.date)}`} style={{ left: menu.x, top: menu.y }}><button type="button" role="menuitem" className="danger" disabled={deletingSessionId === menu.session.id} onClick={() => void deleteFromMenu()}><Trash2 aria-hidden="true" />Delete standup</button></div>, document.body)}
  </section>;
}

function StandupRecordLegend() {
  return <div className="standup-record-legend" aria-label="Standup record status legend"><span><CircleCheck aria-hidden="true" />Complete</span><span><CircleDashed aria-hidden="true" />Incomplete</span></div>;
}

function StandupRecordCard({ session, loading, onOpen, onContextMenu }: { session: StandupSession; loading: boolean; onOpen: (sessionId: string) => void; onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, session: StandupSession) => void }) {
  const status = standupRecordStatus(session.status); const date = parseIso(session.date);
  const day = date.getUTCDate();
  const StatusIcon = status.complete ? CircleCheck : CircleDashed;
  return <button type="button" className={`standup-record-card${status.complete ? ' is-complete' : ' is-incomplete'}`} disabled={loading} aria-label={`Open standup record for ${formatDate(session.date)}. ${status.label}. Right-click for delete options.`} title={`${status.label} — right-click for delete options`} onClick={() => onOpen(session.id)} onContextMenu={(event) => onContextMenu(event, session)} data-testid={`standup-record-${session.id}`}>
    <span className="standup-record-date"><strong>{day}</strong></span><StatusIcon aria-hidden="true" />{loading && <span className="sr-only">Loading record</span>}
  </button>;
}
