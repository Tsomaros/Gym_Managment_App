/**
 * Calendar-day helpers for the schedule screens. Dates are ISO strings (YYYY-MM-DD) meaning days in
 * the gym's time zone; arithmetic is done on UTC midnights, so DST never shifts a date.
 */
const DAY_MS = 86_400_000;

const toUtc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

export const addDays = (iso: string, days: number): string =>
  new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);

/** 1 = Monday … 7 = Sunday, like the API. */
export function isoWeekday(iso: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const js = new Date(toUtc(iso)).getUTCDay();
  return (js === 0 ? 7 : js) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export const mondayOf = (iso: string): string => addDays(iso, 1 - isoWeekday(iso));

export const weekDates = (monday: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** The calendar day it is in `timezone` at `now` (en-CA formats as YYYY-MM-DD). */
export function todayIn(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
