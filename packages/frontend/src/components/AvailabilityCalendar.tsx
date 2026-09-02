import { addDays, diffDays, formatIso, parseIso, type IsoDate } from '@ecp/shared';
import type { AvailabilityEntry } from '../lib/availability';
import { KIND_LABEL } from '../lib/availability';
import { computeDomain, makeScale, monthTicks } from '../lib/timeline';
import { formatDate, formatDayShort, formatMonth } from '../lib/format';
import { MemberAvatar } from './MemberAvatar';

interface AvailabilityCalendarProps {
  entries: AvailabilityEntry[];
  disabled: boolean;
  onDelete: (entry: AvailabilityEntry) => void;
  onMove: (entry: AvailabilityEntry, startDate: IsoDate, endDate: IsoDate) => void;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Minimum band width (px-ish, as a % floor is awkward) — handled via CSS min-width. */

/**
 * A horizontal calendar of availability: each PTO / on-call / velocity entry is
 * a band spanning its date range, tinted by kind, with the member's colored
 * avatar + initials inside so you can read who's out at a glance. A "today"
 * marker and month ticks give temporal context.
 */
export function AvailabilityCalendar({ entries, disabled, onDelete, onMove }: AvailabilityCalendarProps) {
  if (entries.length === 0) {
    return <div className="hint empty" data-testid="availability-empty">No availability entries yet. Use “Add” to create one.</div>;
  }

  const today = todayIso();
  const domain = computeDomain([today, ...entries.flatMap((e) => [e.startDate, e.endDate])], 3);
  const scale = makeScale(domain.start, domain.end);
  const pct = (d: string) => `${(scale.fractionOf(d) * 100).toFixed(3)}%`;

  return (
    <div className="availability-calendar" data-testid="availability-calendar">
      <div className="cal-axis">
        {monthTicks(domain.start, domain.end).map((t) => (
          <span key={t} className="cal-month" style={{ left: pct(t) }}>
            {formatMonth(t)}
          </span>
        ))}
        <span className="cal-today" style={{ left: pct(today) }} title={`Today — ${formatDate(today)}`} />
      </div>

      <div className="cal-rows" onDragOver={(event) => { if (!disabled) event.preventDefault(); }} onDrop={(event) => { const id = event.dataTransfer.getData('application/x-ecp-availability'); if (!id || disabled) return; const entry = entries.find((item) => item.id === id); const bounds = event.currentTarget.getBoundingClientRect(); if (!entry || !bounds.width) return; const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)); const start = dateAtFraction(domain.start, domain.end, fraction); const duration = diffDays(entry.startDate, entry.endDate); onMove(entry, start, addDays(start, duration)); }}>
        {/* The today line spans the whole row stack. */}
        <span className="cal-today-line" style={{ left: pct(today) }} />
        {entries.map((e) => {
          const left = scale.fractionOf(e.startDate);
          const width = Math.max(0, scale.fractionOf(e.endDate) - left);
          const title = `${e.memberName} · ${KIND_LABEL[e.kind]}${e.multiplier !== undefined ? ` ×${e.multiplier}` : ''} · ${formatDate(e.startDate)} → ${formatDate(e.endDate)}${e.note ? `\n${e.note}` : ''}`;
          const bandText = e.note
            ? e.note
            : e.kind === 'velocity'
              ? `×${e.multiplier}`
              : formatDayShort(e.startDate);
          return (
            <div className="cal-row" key={`${e.kind}-${e.id}`} data-testid={`cal-row-${e.id}`}>
              <div
                className={`cal-band kind-${e.kind}`}
                style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                title={title}
                draggable={!disabled}
                onDragStart={(event) => event.dataTransfer.setData('application/x-ecp-availability', e.id)}
              >
                <MemberAvatar name={e.memberName} color={e.color} size={20} />
                <span className="cal-band-text">{bandText}</span>
                {!disabled && (
                  <button
                    type="button"
                    className="cal-band-del"
                    title="Remove"
                    aria-label={`Remove ${title}`}
                    onClick={() => onDelete(e)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="legend-item"><span className="swatch kind-pto" /> PTO</span>
        <span className="legend-item"><span className="swatch kind-oncall" /> On-call</span>
        <span className="legend-item"><span className="swatch kind-velocity" /> Velocity override</span>
        <span className="legend-item cal-legend-note">Circle = team member</span>
      </div>
    </div>
  );
}

function dateAtFraction(start: IsoDate, end: IsoDate, fraction: number): IsoDate {
  const days = diffDays(start, end);
  return formatIso(new Date(parseIso(start).getTime() + Math.round(days * fraction) * 86_400_000));
}
