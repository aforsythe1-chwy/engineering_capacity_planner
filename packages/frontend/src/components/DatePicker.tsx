import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  disabled?: boolean;
  ariaLabel: string;
  inputTestId?: string;
}

/**
 * Planner-styled, text-editable calendar picker for ISO calendar dates.
 * The typed field accepts both YYYY-MM-DD and the displayed MM/DD/YYYY form.
 */
export function DatePicker({ value, onChange, min, disabled = false, ariaLabel, inputTestId }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [opensUpward, setOpensUpward] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const [draft, setDraft] = useState(() => formatDate(value));
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(value));
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const gridId = useId();

  useEffect(() => { setDraft(formatDate(value)); }, [value]);
  useEffect(() => { if (!open) return; setViewMonth(firstOfMonth(value)); }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); input.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const days = useMemo(() => monthDays(viewMonth), [viewMonth]);
  const commitDraft = () => {
    const parsed = parseTypedDate(draft);
    if (parsed && (!min || parsed >= min)) onChange(parsed);
    else setDraft(formatDate(value));
  };
  const choose = (date: string) => { onChange(date); setDraft(formatDate(date)); setOpen(false); requestAnimationFrame(() => input.current?.focus()); };
  const toggle = () => {
    if (!open) {
      const bounds = root.current?.getBoundingClientRect();
      if (bounds) {
        const upward = window.innerHeight - bounds.bottom < 320 && bounds.top > window.innerHeight - bounds.bottom;
        setOpensUpward(upward);
        setPopoverPosition(upward ? { left: bounds.left, bottom: window.innerHeight - bounds.top + 6 } : { left: bounds.left, top: bounds.bottom + 6 });
      }
    }
    setOpen((current) => !current);
  };

  return <div className="date-picker" ref={root}>
    <input ref={input} type="text" inputMode="numeric" value={draft} disabled={disabled} aria-label={ariaLabel} data-testid={inputTestId} placeholder="MM/DD/YYYY" onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={(event) => { if (event.key === 'Enter') { commitDraft(); setOpen(false); } }} />
    <button type="button" className="date-picker-trigger" disabled={disabled} aria-label={`Choose ${ariaLabel}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={gridId} onClick={toggle}>
      <CalendarIcon />
    </button>
    {open && createPortal(<div ref={popover} style={popoverPosition} className={`date-picker-popover${opensUpward ? ' opens-upward' : ''}`} id={gridId} role="dialog" aria-label={`Choose ${ariaLabel}`}>
      <div className="date-picker-heading"><button type="button" className="date-picker-nav" aria-label="Previous month" onClick={() => setViewMonth(offsetMonth(viewMonth, -1))}>‹</button><strong>{monthLabel(viewMonth)}</strong><button type="button" className="date-picker-nav" aria-label="Next month" onClick={() => setViewMonth(offsetMonth(viewMonth, 1))}>›</button></div>
      <div className="date-picker-weekdays" aria-hidden="true">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="date-picker-days" role="grid" aria-label={monthLabel(viewMonth)}>{days.map((date) => {
        const adjacent = !date.startsWith(viewMonth.slice(0, 7)); const unavailable = Boolean(min && date < min);
        return <button key={date} type="button" role="gridcell" className={`date-picker-day${adjacent ? ' adjacent' : ''}${date === value ? ' selected' : ''}${date === todayIso() ? ' today' : ''}`} aria-label={formatLongDate(date)} aria-selected={date === value} disabled={unavailable} onClick={() => choose(date)}>{Number(date.slice(-2))}</button>;
      })}</div>
      <div className="date-picker-footer"><button type="button" className="link-btn" onClick={() => { const current = todayIso(); if (!min || current >= min) choose(current); }}>Today</button></div>
    </div>, document.body)}
  </div>;
}

function CalendarIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5v2M13 2.5v2M2.5 5.5h11M3.5 3.5h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
const todayIso = () => new Date().toISOString().slice(0, 10);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
const offsetMonth = (date: string, amount: number) => isoDate(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + amount, 1)));
const monthLabel = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const formatLongDate = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const formatDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}` : '';
function parseTypedDate(text: string): string | null {
  const match = text.trim().match(/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]); const month = Number(match[2] ?? match[4]); const day = Number(match[3] ?? match[5]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day ? isoDate(candidate) : null;
}
function monthDays(month: string): string[] {
  const first = new Date(`${month}T00:00:00Z`); const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => isoDate(new Date(start.getTime() + index * 86_400_000)));
}
