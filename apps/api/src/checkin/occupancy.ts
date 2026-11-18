import type { OccupancyLevel } from '@gym/shared';

/** Quiet below 40 % of capacity, moderate below 75 %, busy from 75 % (whole numbers, no rounding). */
export function levelFor(present: number, capacity: number): OccupancyLevel {
  if (present * 100 < 40 * capacity) return 'quiet';
  if (present * 100 < 75 * capacity) return 'moderate';
  return 'busy';
}
