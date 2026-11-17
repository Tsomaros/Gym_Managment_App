import type { MembershipKind } from '@gym/shared';
import { type DateRange, daysBetweenInclusive } from './dates';

export type MembershipStatus = 'voided' | 'upcoming' | 'frozen' | 'active' | 'used_up' | 'expired';

export interface StatusInput {
  kind: MembershipKind;
  startsOn: string;
  /** The effective end (base end plus frozen days), or null when there is none. */
  endsOn: string | null;
  visitsTotal: number | null;
  visitsUsed: number;
  voidedAt: Date | null;
}

/** Checked in this order: voided, upcoming, frozen, used up, expired, else active. */
export function membershipStatus(
  m: StatusInput,
  freezes: readonly DateRange[],
  today: string,
): MembershipStatus {
  if (m.voidedAt) return 'voided';
  if (today < m.startsOn) return 'upcoming';
  if (freezes.some((f) => f.startsOn <= today && today <= f.endsOn)) return 'frozen';
  if (m.visitsTotal !== null && m.visitsUsed >= m.visitsTotal) return 'used_up';
  if (m.endsOn !== null && today > m.endsOn) return 'expired';
  return 'active';
}

/**
 * Days left including today (the whole period before it starts, 0 after it ends; null without an
 * end date) and visits left (null for time-based memberships).
 */
export function remaining(
  m: StatusInput,
  _freezes: readonly DateRange[],
  today: string,
): { days: number | null; visits: number | null } {
  let days: number | null = null;
  if (m.endsOn !== null) {
    const from = today < m.startsOn ? m.startsOn : today;
    days = Math.max(0, daysBetweenInclusive(from, m.endsOn));
  }
  const visits = m.visitsTotal === null ? null : Math.max(0, m.visitsTotal - m.visitsUsed);
  return { days, visits };
}
