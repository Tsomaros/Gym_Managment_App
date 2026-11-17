import type { CheckInReason, Membership } from '@gym/shared';

export type CheckInDecision =
  | { valid: true; useMembershipId: string; consumeVisit: boolean }
  | { valid: false; reason: CheckInReason };

/** Earliest end first, memberships without an end last, then the older sale. */
function byEndThenSale(a: Membership, b: Membership): number {
  const ea = a.effectiveEndsOn;
  const eb = b.effectiveEndsOn;
  if (ea !== eb) {
    if (ea === null) return 1;
    if (eb === null) return -1;
    return ea < eb ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Whether a member may enter, from their memberships already evaluated for today (spec §6.2).
 * An active time membership wins and uses no visit; otherwise an active visit pack or day pass
 * with visits left is used, the one that ends first. Class packs don't open the gym door.
 * Pure: no clock, no database.
 */
export function decideCheckIn(ms: readonly Membership[]): CheckInDecision {
  const live = ms.filter((m) => m.status !== 'voided');
  const active = live.filter((m) => m.status === 'active');

  const time = active.filter((m) => m.kind === 'time').sort(byEndThenSale)[0];
  if (time) return { valid: true, useMembershipId: time.id, consumeVisit: false };

  const pack = active
    .filter((m) => (m.kind === 'visits' || m.kind === 'day_pass') && (m.remaining.visits ?? 0) > 0)
    .sort(byEndThenSale)[0];
  if (pack) return { valid: true, useMembershipId: pack.id, consumeVisit: true };

  const has = (status: Membership['status']) => live.some((m) => m.status === status);
  if (has('frozen')) return { valid: false, reason: 'frozen' };
  if (has('upcoming')) return { valid: false, reason: 'upcoming_only' };
  if (active.some((m) => m.kind === 'classes')) return { valid: false, reason: 'classes_only' };
  if (has('used_up')) return { valid: false, reason: 'used_up' };
  if (has('expired')) return { valid: false, reason: 'expired' };
  return { valid: false, reason: 'no_membership' };
}

/** The membership that explains a refusal, for the reception screen; null when there is none. */
export function relevantMembership(
  ms: readonly Membership[],
  reason: CheckInReason,
): Membership | null {
  const live = ms.filter((m) => m.status !== 'voided');
  const latestEnd = (a: Membership, b: Membership) =>
    (b.effectiveEndsOn ?? '').localeCompare(a.effectiveEndsOn ?? '') ||
    b.createdAt.localeCompare(a.createdAt);
  switch (reason) {
    case 'frozen':
      return live.find((m) => m.status === 'frozen') ?? null;
    case 'upcoming_only':
      return live.filter((m) => m.status === 'upcoming').sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? null;
    case 'classes_only':
      return live.find((m) => m.status === 'active' && m.kind === 'classes') ?? null;
    case 'used_up':
      return live.filter((m) => m.status === 'used_up').sort(latestEnd)[0] ?? null;
    case 'expired':
      return live.filter((m) => m.status === 'expired').sort(latestEnd)[0] ?? null;
    case 'no_membership':
      return null;
  }
}
