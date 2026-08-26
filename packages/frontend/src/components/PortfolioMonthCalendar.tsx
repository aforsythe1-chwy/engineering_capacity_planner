import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { addDays, diffDays, formatIso, getWeekday, parseIso, type IsoDate } from '@ecp/shared';
import { formatDate, formatMonth } from '../lib/format';
import { ImportantDateIcon } from './ImportantDateIcon';
import type { PortfolioCalendarEvent, PortfolioCalendarModel, PortfolioCalendarSprint, PortfolioCalendarWeek } from '../lib/portfolioCalendar';

type Layer = 'importantDates' | 'relevantDays' | 'devComplete' | 'sprints' | 'sharedLoad';
const FILTERS: ReadonlyArray<{ key: Layer; label: string }> = [
  { key: 'importantDates', label: 'Important dates' },
  { key: 'relevantDays', label: 'Relevant days' },
  { key: 'devComplete', label: 'Projected completion' },
  { key: 'sprints', label: 'Sprints' },
  { key: 'sharedLoad', label: 'Shared load' },
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_EVENTS = 3;

export function PortfolioMonthCalendar({ model, onAddImportantDate, heading = 'Portfolio calendar', supportingCopy = 'Timeline dates by epic, with total shared load kept visible across the portfolio.', highlightedSprintId }: { model: PortfolioCalendarModel; onAddImportantDate?: () => void; heading?: string; supportingCopy?: string; highlightedSprintId?: string | null }) {
  const todayMonth = firstOfMonth(model.today);
  const [month, setMonth] = useState(todayMonth);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ importantDates: true, relevantDays: true, devComplete: true, sprints: true, sharedLoad: true });
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedDate, setExpandedDate] = useState<IsoDate | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const days = useMemo(() => monthGridDays(month), [month]);
  const weeks = useMemo(() => chunkWeeks(days), [days]);
  const byDate = useMemo(() => {
    const result = new Map<IsoDate, PortfolioCalendarEvent[]>();
    for (const event of model.events) {
      if ((event.kind === 'important-date' && !layers.importantDates) || (event.kind === 'dev-complete' && !layers.devComplete) || ((event.kind === 'gating' || event.kind === 'milestone') && !layers.relevantDays)) continue;
      result.set(event.date, [...(result.get(event.date) ?? []), event]);
    }
    return result;
  }, [model.events, layers.devComplete, layers.importantDates, layers.relevantDays]);

  useEffect(() => {
    if (!filterOpen) return;
    const outside = (event: PointerEvent) => { if (filterRef.current && !filterRef.current.contains(event.target as Node)) setFilterOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [filterOpen]);
  useEffect(() => {
    if (!expandedDate) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpandedDate(null); requestAnimationFrame(() => disclosureRef.current?.focus()); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [expandedDate]);

  const hiddenCount = FILTERS.filter((item) => !layers[item.key]).length;
  const monthNumber = parseIso(month).getUTCMonth();
  return <section className="panel proj-calendar portfolio-calendar" data-testid="portfolio-calendar" aria-labelledby="portfolio-calendar-title">
    <div className="cal-toolbar">
      <div className="cal-toolbar-left"><h2 id="portfolio-calendar-title">{heading}</h2><span className="hint">{supportingCopy}</span></div>
      <div className="cal-controls">
        {onAddImportantDate && <button type="button" className="btn primary calendar-add-date" onClick={onAddImportantDate}>Add day</button>}
        <div className="cal-filter" ref={filterRef}>
          <button type="button" className={`cal-filter-btn${hiddenCount ? ' has-hidden' : ''}`} data-testid="portfolio-cal-filter-btn" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}>Layers{hiddenCount > 0 && <span className="cal-filter-badge">{hiddenCount}</span>}</button>
          {filterOpen && <div className="cal-filter-menu" role="menu" data-testid="portfolio-cal-filter-menu"><div className="cal-filter-title">Show on calendar</div>{FILTERS.map((item) => <label className="cal-filter-item" key={item.key} role="menuitemcheckbox" aria-checked={layers[item.key]}><input type="checkbox" checked={layers[item.key]} data-testid={`portfolio-cal-filter-${item.key}`} onChange={(event) => setLayers((current) => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}</div>}
        </div>
        <div className="cal-nav">
          <button type="button" className="cal-nav-btn" data-testid="portfolio-cal-prev" aria-label="Previous month" onClick={() => setMonth(offsetMonth(month, -1))}>‹</button>
          <span className="cal-cur-month" id="portfolio-calendar-month" data-testid="portfolio-cal-current-month">{formatMonth(month)}</span>
          <button type="button" className="cal-nav-btn" data-testid="portfolio-cal-next" aria-label="Next month" onClick={() => setMonth(offsetMonth(month, 1))}>›</button>
          <button type="button" className="cal-today-btn" data-testid="portfolio-cal-today" disabled={month === todayMonth} onClick={() => setMonth(todayMonth)}>Today</button>
        </div>
      </div>
    </div>
    {!model.hasVisibleDatedEvents && <p className="calendar-empty" role="status">No dated Timeline events yet. Add relevant days or enough planning input for a forecast.</p>}
    <div className="portfolio-calendar-scroll" role="region" aria-label={`${formatMonth(month)} calendar grid`} tabIndex={0}>
      <div className="cal-month-grid" role="grid" aria-labelledby="portfolio-calendar-month" data-testid="portfolio-cal-month-grid">
        <div className="cal-weekhead" role="row">{WEEKDAYS.map((day) => <div className="cal-weekday" role="columnheader" key={day}>{day}</div>)}</div>
        {weeks.map((weekDays) => {
          const rowStart = weekDays[0]!; const rowEnd = weekDays[6]!;
          const sprintBands = layers.sprints ? model.sprints.filter((item) => item.start <= rowEnd && item.end >= rowStart) : [];
          const loadBands = layers.sharedLoad ? model.weeks.filter((item) => item.start <= rowEnd && item.end >= rowStart) : [];
          const sprintHeight = sprintBands.length * 17;
          return <div className="cal-week portfolio-cal-week" role="row" key={rowStart} style={{ '--bars-h': sprintBands.length || loadBands.length ? `${sprintHeight + (loadBands.length ? 23 : 0) + 4}px` : '0px' } as CSSProperties}>
            {(sprintBands.length > 0 || loadBands.length > 0) && <div className="cal-week-overlay">{sprintBands.map((sprint, index) => <SprintBand key={sprint.id} sprint={sprint} rowStart={rowStart} rowEnd={rowEnd} top={4 + index * 17} highlighted={sprint.id === highlightedSprintId} />)}{loadBands.map((band) => <LoadBand key={band.start} band={band} rowStart={rowStart} rowEnd={rowEnd} top={4 + sprintHeight} />)}</div>}
            <div className="cal-week-days">{weekDays.map((date) => {
              const events = byDate.get(date) ?? []; const hidden = events.slice(MAX_VISIBLE_EVENTS); const adjacent = parseIso(date).getUTCMonth() !== monthNumber;
              return <div className={`cal-cell${adjacent ? ' adjacent' : ''}${date === model.today ? ' is-today' : ''}`} role="gridcell" aria-label={`${formatDate(date)}${date === model.today ? ', today' : ''}`} key={date} data-testid={`portfolio-cal-day-${date}`}>
                <div className="cal-cell-head"><span className="cal-daynum">{parseIso(date).getUTCDate()}</span></div>
                {events.length > 0 && <div className="cal-events">{events.slice(0, MAX_VISIBLE_EVENTS).map((event) => <CalendarEvent event={event} key={event.id} />)}{hidden.length > 0 && <div className="calendar-more-wrap"><button ref={expandedDate === date ? disclosureRef : undefined} type="button" className="calendar-more" aria-expanded={expandedDate === date} aria-haspopup="dialog" onClick={() => setExpandedDate((open) => open === date ? null : date)}>+{hidden.length} more</button>{expandedDate === date && <div className="calendar-more-popover" role="dialog" aria-label={`More events for ${formatDate(date)}`}>{hidden.map((event) => <CalendarEvent event={event} key={event.id} />)}<button type="button" className="link-btn" onClick={() => { setExpandedDate(null); requestAnimationFrame(() => disclosureRef.current?.focus()); }}>Close</button></div>}</div>}</div>}
              </div>;
            })}</div>
          </div>;
        })}
      </div>
    </div>
    <div className="cal-legend"><span className="legend-item"><span className="cal-dot today" /> Today</span>{layers.importantDates && <span className="legend-item"><span className="cal-dot important-date" /> Important date</span>}{layers.relevantDays && <><span className="legend-item"><span className="cal-dot gating" /> Gating relevant day</span><span className="legend-item"><span className="cal-dot milestone" /> Relevant day</span></>}{layers.devComplete && <span className="legend-item"><span className="cal-dot devcomplete green" /> Projected completion</span>}{layers.sprints && model.sprints.length > 0 && <span className="legend-item"><span className="cal-bar-swatch sprint" /> Sprint</span>}{layers.sharedLoad && (model.weeks.length ? <span className="legend-item"><span className="cal-bar-swatch sprint load-green" /> Shared load / capacity</span> : <span className="legend-item">No scheduled load</span>)}</div>
  </section>;
}

function CalendarEvent({ event }: { event: PortfolioCalendarEvent }) {
  const kind = event.kind === 'dev-complete' ? 'devcomplete' : event.kind;
  const health = event.kind === 'dev-complete' && ['green', 'yellow', 'red'].includes(event.health ?? '') ? ` ${event.health}` : '';
  const state = event.kind === 'important-date' ? 'Global important date' : event.kind === 'gating' ? 'Gating relevant day' : event.kind === 'milestone' ? 'Relevant day' : `Projected completion${health ? `, ${event.health} health` : ''}`;
  const details = event.kind === 'important-date' ? event.notes : null;
  const label = `${event.label}. ${state}.${details ? ` ${details}` : ''}`;
  const content = <>{event.kind === 'important-date' && <ImportantDateIcon iconKey={event.iconKey} />}<span className="cal-event-text">{event.label}</span>{event.kind === 'important-date' && event.linkUrl && <span className="cal-event-link-mark" aria-hidden="true">↗</span>}</>;
  if (event.kind === 'important-date') {
    const title = event.notes ? `${event.label}: ${event.notes}` : event.label;
    return event.linkUrl
      ? <a className={`cal-event ${kind}${health}`} href={event.linkUrl} target="_blank" rel="noreferrer" title={title} aria-label={`${label} Opens associated link in a new tab.`} data-event-kind={event.kind}>{content}</a>
      : <div className={`cal-event ${kind}${health}`} title={title} aria-label={label} data-event-kind={event.kind}>{content}</div>;
  }
  return <div className={`cal-event ${kind}${health}`} title={event.label} aria-label={label} data-event-kind={event.kind}>{content}</div>;
}

function LoadBand({ band, rowStart, rowEnd, top }: { band: PortfolioCalendarWeek; rowStart: IsoDate; rowEnd: IsoDate; top: number }) {
  const start = band.start > rowStart ? band.start : rowStart; const end = band.end < rowEnd ? band.end : rowEnd;
  const first = diffDays(rowStart, start); const count = diffDays(start, end) + 1;
  const tone = band.slack < 0 ? 'red' : band.slack === 0 ? 'yellow' : 'green';
  const selected = band.selectedLoad === null ? '' : ` · ${band.selectedLoad} pts selected`;
  const label = `${band.totalLoad} / ${band.capacity} pts total${selected}`;
  const style: CSSProperties = { left: `calc(${first / 7 * 100}% + 2px)`, width: `calc(${count / 7 * 100}% - 4px)`, top, height: 19 };
  return <div className={`cal-bar sprint load-${tone}`} style={style} role="note" aria-label={`${label}. ${band.slack < 0 ? `${Math.abs(band.slack)} pts over capacity` : `${band.slack} pts slack`}.`} title={`${label} · ${band.slack} pts slack`} data-testid={`portfolio-load-${band.start}`} data-total-load={band.totalLoad} data-capacity={band.capacity}><span className="cal-bar-text">{label}</span></div>;
}

function SprintBand({ sprint, rowStart, rowEnd, top, highlighted }: { sprint: PortfolioCalendarSprint; rowStart: IsoDate; rowEnd: IsoDate; top: number; highlighted?: boolean }) {
  const start = sprint.start > rowStart ? sprint.start : rowStart; const end = sprint.end < rowEnd ? sprint.end : rowEnd;
  const first = diffDays(rowStart, start); const count = diffDays(start, end) + 1;
  const style: CSSProperties = { left: `calc(${first / 7 * 100}% + 2px)`, width: `calc(${count / 7 * 100}% - 4px)`, top, height: 14 };
  return <div className={`cal-bar sprint cadence${highlighted ? ' is-highlighted' : ''}`} style={style} role="note" aria-label={`${sprint.name}, ${sprint.teamName}. ${formatDate(sprint.start)} through ${formatDate(sprint.end)}.`} title={`${sprint.teamName} · ${sprint.name} · ${formatDate(sprint.start)}–${formatDate(sprint.end)}`} data-testid={`portfolio-sprint-${sprint.id}`}><span className="cal-bar-text">{sprint.name}</span></div>;
}

const firstOfMonth = (date: IsoDate): IsoDate => { const value = parseIso(date); return formatIso(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))); };
const offsetMonth = (date: IsoDate, amount: number): IsoDate => { const value = parseIso(date); return formatIso(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1))); };
export function monthGridDays(month: IsoDate): IsoDate[] { const first = firstOfMonth(month); const value = parseIso(first); const last = formatIso(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0))); const start = addDays(first, -getWeekday(first)); const end = addDays(last, 6 - getWeekday(last)); const result: IsoDate[] = []; for (let date = start; date <= end; date = addDays(date, 1)) result.push(date); return result; }
const chunkWeeks = (days: IsoDate[]): IsoDate[][] => { const result: IsoDate[][] = []; for (let index = 0; index < days.length; index += 7) result.push(days.slice(index, index + 7)); return result; };
