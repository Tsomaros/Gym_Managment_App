import { classEndTime, type ClassSeries } from '@gym/shared';
import { isoWeekday } from '../shifts/expand';
import { addDays } from '../memberships/dates';

export interface NewSession {
  seriesId: string;
  classTypeId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  trainerId: string | null;
  room: string | null;
}

/**
 * Occurrences of the weekly series on `from..to` (inclusive gym dates) that don't exist yet.
 * `existing` lists every session already stored for the series, cancelled ones included, so a
 * cancelled day is never recreated.
 */
export function materialiseSeries(
  series: readonly ClassSeries[],
  existing: readonly { seriesId: string | null; date: string }[],
  from: string,
  to: string,
): NewSession[] {
  const have = new Set(existing.map((e) => `${e.seriesId}|${e.date}`));
  const out: NewSession[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const weekday = isoWeekday(d);
    for (const s of series) {
      if (s.weekday !== weekday || d < s.validFrom || (s.validUntil !== null && d > s.validUntil)) {
        continue;
      }
      if (have.has(`${s.id}|${d}`)) continue;
      out.push({
        seriesId: s.id,
        classTypeId: s.classTypeId,
        date: d,
        startsAt: s.startsAt,
        endsAt: classEndTime(s.startsAt, s.durationMinutes)!,
        capacity: s.capacity,
        trainerId: s.trainerId,
        room: s.room,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt));
}

/** Milliseconds the zone is ahead of UTC at the instant `ms`. */
function offsetAt(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/**
 * The instant at which the wall clock in `tz` reads `date` `time` (HH:MM). No date library: the
 * offsets on either side of the day are tried and kept when the zone really has that offset at the
 * result. A time that happens twice (clocks go back) takes the first occurrence; a time that
 * doesn't exist (clocks go forward) moves forward by the length of the gap.
 */
export function localToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const before = offsetAt(naive - DAY_MS, tz);
  const after = offsetAt(naive + DAY_MS, tz);
  const valid = [...new Set([before, after])]
    .map((o) => naive - o)
    .filter((t) => offsetAt(t, tz) === naive - t);
  if (valid.length) return new Date(Math.min(...valid));
  return new Date(naive - before);
}
