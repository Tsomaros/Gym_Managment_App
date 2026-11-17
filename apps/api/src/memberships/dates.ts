/**
 * Calendar-day arithmetic for memberships. Dates are ISO strings (YYYY-MM-DD) meaning days in the
 * gym's time zone; all arithmetic is done on UTC midnights, so DST never shifts a date.
 */

export interface DateRange {
  startsOn: string;
  endsOn: string;
}

const DAY_MS = 86_400_000;

const toUtc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The calendar day it is in `timezone` at the instant `now` (en-CA formats as YYYY-MM-DD). */
export function todayIn(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Days from `from` to `to`, both included: the same day is 1. */
export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/**
 * Last day of a period of `months` starting on `start`: the day before the same day-of-month
 * `months` later. If that day doesn't exist in the target month (31 → February), the period ends
 * on the last day of the target month.
 */
export function periodEnd(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const targetMonth = m - 1 + months; // 0-based, may exceed 11
  const lastDayOfTarget = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  if (d > lastDayOfTarget) return fromUtc(Date.UTC(y, targetMonth, lastDayOfTarget));
  return fromUtc(Date.UTC(y, targetMonth, d) - DAY_MS);
}

/** Total frozen days, each freeze counted inclusively. */
export function frozenDays(freezes: readonly DateRange[]): number {
  return freezes.reduce((sum, f) => sum + daysBetweenInclusive(f.startsOn, f.endsOn), 0);
}

/** The end moved forward by every frozen day; null stays null (no end date). */
export function effectiveEnd(
  baseEndsOn: string | null,
  freezes: readonly DateRange[],
): string | null {
  return baseEndsOn === null ? null : addDays(baseEndsOn, frozenDays(freezes));
}
