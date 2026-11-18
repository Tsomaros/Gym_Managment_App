import type { Measure } from '@gym/shared';
import { addDays } from '../memberships/dates';

/** Monday (ISO week start) of the week containing `date` (YYYY-MM-DD, a gym-local day). */
export function isoWeekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** The `n` week starts ending with the week of `today`, oldest first. */
export function lastWeeks(today: string, n: number): string[] {
  const current = isoWeekStart(today);
  return Array.from({ length: n }, (_, i) => addDays(current, -7 * (n - 1 - i)));
}

/** Estimated one-rep max (Epley), 1–12 reps only, rounded to the nearest 0.5 kg. */
export function e1rm(weightKg: number, reps: number): number | null {
  if (!Number.isInteger(reps) || reps < 1 || reps > 12) return null;
  return Math.round(weightKg * (1 + reps / 30) * 2) / 2;
}

/** The heaviest set; equal weights go to more reps. */
export function topSet(
  sets: readonly { weightKg: number; reps: number }[],
): { weightKg: number; reps: number } | null {
  let best: { weightKg: number; reps: number } | null = null;
  for (const s of sets) {
    if (
      !best ||
      s.weightKg > best.weightKg ||
      (s.weightKg === best.weightKg && s.reps > best.reps)
    ) {
      best = { weightKg: s.weightKg, reps: s.reps };
    }
  }
  return best;
}

export interface VolumeSet {
  /** The measure the set was logged with (a snapshot, never the exercise's current one). */
  measure: Measure;
  done: boolean;
  reps: number | null;
  weightKg: number | null;
  /** The gym-local day the set was logged. */
  localDate: string;
}

/** Σ weight × reps of the done weight_reps sets, per listed week. */
export function weeklyVolume(
  sets: readonly VolumeSet[],
  weeks: readonly string[],
): { weekStart: string; volumeKg: number }[] {
  const totals = new Map(weeks.map((w) => [w, 0]));
  for (const s of sets) {
    if (s.measure !== 'weight_reps' || !s.done || s.reps === null || s.weightKg === null) continue;
    const week = isoWeekStart(s.localDate);
    if (totals.has(week)) totals.set(week, totals.get(week)! + s.weightKg * s.reps);
  }
  return weeks.map((weekStart) => ({ weekStart, volumeKg: totals.get(weekStart)! }));
}

/** Distinct gym days with a valid check-in, per listed week. */
export function weeklyAttendance(
  checkInDates: readonly string[],
  weeks: readonly string[],
): { weekStart: string; days: number }[] {
  const perWeek = new Map(weeks.map((w) => [w, new Set<string>()]));
  for (const d of checkInDates) perWeek.get(isoWeekStart(d))?.add(d);
  return weeks.map((weekStart) => ({ weekStart, days: perWeek.get(weekStart)!.size }));
}
