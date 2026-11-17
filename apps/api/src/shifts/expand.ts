import type { ExpandedShift, ShiftRow, ShiftSeries, Weekday } from '@gym/shared';
import { addDays } from '../memberships/dates';

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. UTC arithmetic, so DST never matters. */
export function isoWeekday(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

/**
 * Concrete shifts for the dates `from..to` (inclusive, gym-local). Series occurrences first, then
 * overrides (a row with a seriesId replaces or, if cancelled, removes that day's occurrence),
 * then one-offs. Sorted by date, start time, staff id.
 */
export function expandShifts(
  series: readonly ShiftSeries[],
  rows: readonly ShiftRow[],
  from: string,
  to: string,
): ExpandedShift[] {
  const out = new Map<string, ExpandedShift>(); // keyed by series + date
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const weekday = isoWeekday(d);
    for (const s of series) {
      if (s.weekday !== weekday || d < s.validFrom || (s.validUntil !== null && d > s.validUntil)) {
        continue;
      }
      out.set(`${s.id}|${d}`, {
        staffId: s.staffId,
        date: d,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        seriesId: s.id,
        shiftId: null,
        note: null,
      });
    }
  }

  const oneOffs: ExpandedShift[] = [];
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    if (r.seriesId !== null) {
      const key = `${r.seriesId}|${r.date}`;
      const occurrence = out.get(key);
      if (!occurrence) continue; // the series isn't active that day
      if (r.cancelled) out.delete(key);
      else {
        out.set(key, {
          ...occurrence,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          shiftId: r.id,
          note: r.note,
        });
      }
    } else if (!r.cancelled) {
      oneOffs.push({
        staffId: r.staffId,
        date: r.date,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        seriesId: null,
        shiftId: r.id,
        note: r.note,
      });
    }
  }

  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...out.values(), ...oneOffs].sort(
    (a, b) => cmp(a.date, b.date) || cmp(a.startsAt, b.startsAt) || cmp(a.staffId, b.staffId),
  );
}

/** Whether `staffId` is on a shift at `time` (HH:MM) on `date`: start inclusive, end exclusive. */
export function isOnDuty(
  shifts: readonly ExpandedShift[],
  staffId: string,
  date: string,
  time: string,
): boolean {
  return shifts.some(
    (s) => s.staffId === staffId && s.date === date && s.startsAt <= time && time < s.endsAt,
  );
}
