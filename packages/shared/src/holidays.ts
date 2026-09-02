import type { AnnualHolidayRecurrence, IsoDate, TeamHoliday, TeamHolidayOccurrence } from './domain.js';
import { addDays, formatIso, getWeekday, parseIso } from './dates.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): IsoDate {
  return formatIso(new Date(Date.UTC(year, month - 1, day)));
}

function assertRange(start: IsoDate, end: IsoDate): void {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || formatIso(parseIso(start)) !== start || formatIso(parseIso(end)) !== end || start > end) {
    throw new RangeError('Holiday occurrence range must be valid ISO dates with start on or before end');
  }
}

/** Validate the closed recurrence vocabulary before persistence or calculation. */
export function assertAnnualHolidayRecurrence(value: AnnualHolidayRecurrence): void {
  if (!Number.isInteger(value.month) || value.month < 1 || value.month > 12) throw new RangeError('Holiday month must be 1–12');
  if (value.kind === 'fixed-date') {
    if (!Number.isInteger(value.day) || value.day < 1 || value.day > daysInMonth(2024, value.month)) throw new RangeError('Holiday day is not valid for its month');
    if (value.observedPolicy !== 'none' && value.observedPolicy !== 'nearest-weekday') throw new RangeError('Holiday observed policy is invalid');
    return;
  }
  if (value.kind !== 'nth-weekday') throw new RangeError('Holiday recurrence kind is invalid');
  if (!Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6) throw new RangeError('Holiday weekday must be 0–6');
  if (![1, 2, 3, 4, 'last'].includes(value.ordinal)) throw new RangeError('Holiday ordinal must be first through fourth or last');
  if (value.observedPolicy !== 'none') throw new RangeError('Weekday holidays cannot have an observed policy');
}

/** Resolve the single observed occurrence of a recurring rule in a calendar year. */
export function holidayOccurrenceForYear(holiday: TeamHoliday, year: number): TeamHolidayOccurrence | null {
  const recurrence = holiday.recurrence;
  if (!recurrence) return null;
  assertAnnualHolidayRecurrence(recurrence);
  let date: IsoDate;
  let observed = false;
  if (recurrence.kind === 'fixed-date') {
    if (recurrence.day > daysInMonth(year, recurrence.month)) return null;
    date = iso(year, recurrence.month, recurrence.day);
    if (recurrence.observedPolicy === 'nearest-weekday') {
      const weekday = getWeekday(date);
      if (weekday === 6) { date = addDays(date, -1); observed = true; }
      if (weekday === 0) { date = addDays(date, 1); observed = true; }
    }
  } else {
    const first = iso(year, recurrence.month, 1);
    const lastDay = daysInMonth(year, recurrence.month);
    if (recurrence.ordinal === 'last') {
      date = iso(year, recurrence.month, lastDay);
      while (getWeekday(date) !== recurrence.weekday) date = addDays(date, -1);
    } else {
      const offset = (recurrence.weekday - getWeekday(first) + 7) % 7;
      const day = 1 + offset + (recurrence.ordinal - 1) * 7;
      if (day > lastDay) return null;
      date = iso(year, recurrence.month, day);
    }
  }
  return { holidayId: holiday.id, teamId: holiday.teamId, name: holiday.name, date, observed };
}

/** Resolve stored annual rules to concrete dates in an inclusive, bounded range. */
export function holidayOccurrences(holidays: readonly TeamHoliday[], start: IsoDate, end: IsoDate): TeamHolidayOccurrence[] {
  assertRange(start, end);
  const startYear = parseIso(start).getUTCFullYear();
  const endYear = parseIso(end).getUTCFullYear();
  const occurrences: TeamHolidayOccurrence[] = [];
  for (const holiday of holidays) {
    if (!holiday.recurrence) {
      if (holiday.date && holiday.date >= start && holiday.date <= end) occurrences.push({ holidayId: holiday.id, teamId: holiday.teamId, name: holiday.name, date: holiday.date, observed: false });
      continue;
    }
    // An observed New Year's Day can land on Dec 31 of the preceding year.
    for (let year = startYear - 1; year <= endYear + 1; year++) {
      const occurrence = holidayOccurrenceForYear(holiday, year);
      if (occurrence && occurrence.date >= start && occurrence.date <= end) occurrences.push(occurrence);
    }
  }
  return occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' }) || a.teamId.localeCompare(b.teamId) || a.holidayId.localeCompare(b.holidayId));
}

/** True when a rule (or a date-specific legacy row) resolves to this date. */
export function isHolidayDate(holidays: readonly TeamHoliday[], date: IsoDate): boolean {
  return holidayOccurrences(holidays, date, date).length > 0;
}

/** Plain-language recurrence label for compact list and modal-preview UI. */
export function describeAnnualHolidayRecurrence(recurrence: AnnualHolidayRecurrence): string {
  assertAnnualHolidayRecurrence(recurrence);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (recurrence.kind === 'fixed-date') return `Every ${months[recurrence.month - 1]} ${recurrence.day}${recurrence.observedPolicy === 'nearest-weekday' ? ' · observed nearest weekday' : ''}`;
  const ordinal = recurrence.ordinal === 'last' ? 'last' : ['first', 'second', 'third', 'fourth'][recurrence.ordinal - 1];
  return `Every ${ordinal} ${weekdays[recurrence.weekday]} in ${months[recurrence.month - 1]}`;
}
