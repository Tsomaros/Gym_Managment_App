import type { Membership } from '@gym/shared';

export type ClassEligibility =
  | { ok: true; membershipId: string; usesEntry: boolean }
  | { ok: false };

/**
 * Which membership pays for a class on the session's date. `ms` carry their status as of that
 * date (`toMembership(row, freezes, sessionDate)`), so "active" already means: started, not ended,
 * not frozen that day, not voided, not used up.
 *
 * (a) A membership that includes classes, other than a class pack, takes no entry and wins.
 * (b) Otherwise a class pack with an available entry: total - used - its bookings still booked.
 */
export function classEligibility(
  ms: readonly Membership[],
  reservedByMembership: Readonly<Record<string, number>>,
): ClassEligibility {
  const open = ms.filter((m) => m.status === 'active' && m.includesClasses);
  const included = open.find((m) => m.kind !== 'classes');
  if (included) return { ok: true, membershipId: included.id, usesEntry: false };
  const pack = open.find(
    (m) =>
      m.kind === 'classes' &&
      m.visitsTotal !== null &&
      m.visitsTotal - m.visitsUsed - (reservedByMembership[m.id] ?? 0) > 0,
  );
  return pack ? { ok: true, membershipId: pack.id, usesEntry: true } : { ok: false };
}
