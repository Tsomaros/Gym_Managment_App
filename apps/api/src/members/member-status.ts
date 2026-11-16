import type { Membership, MemberStatus } from '@gym/shared';

const EXPIRING_DAYS = 7;
const EXPIRING_VISITS = 2;

/** True when a running membership ends within 7 days (today included) or has ≤ 2 visits left. */
function runningOut(m: Membership): boolean {
  return (
    (m.remaining.days !== null && m.remaining.days <= EXPIRING_DAYS) ||
    (m.remaining.visits !== null && m.remaining.visits <= EXPIRING_VISITS)
  );
}

/** A member's overall state from their memberships, each already evaluated for today. */
export function memberStatus(ms: readonly Membership[]): {
  status: MemberStatus;
  currentEndsOn: string | null;
  visitsLeft: number | null;
} {
  const live = ms.filter((m) => m.status !== 'voided');
  if (!live.length) return { status: 'new', currentEndsOn: null, visitsLeft: null };

  const current = live.filter((m) => ['active', 'frozen', 'upcoming'].includes(m.status));
  const ends = current.map((m) => m.effectiveEndsOn).filter((e): e is string => e !== null);
  const currentEndsOn = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null;
  const packs = current.filter((m) => m.remaining.visits !== null);
  const visitsLeft = packs.length
    ? packs.reduce((sum, m) => sum + (m.remaining.visits ?? 0), 0)
    : null;

  const active = current.filter((m) => m.status === 'active');
  const hasUpcoming = current.some((m) => m.status === 'upcoming');
  let status: MemberStatus;
  if (active.length) {
    // Running out only matters when nothing is already booked to follow.
    status = !hasUpcoming && active.every(runningOut) ? 'expiring' : 'active';
  } else if (current.some((m) => m.status === 'frozen')) {
    status = 'frozen';
  } else if (hasUpcoming) {
    status = 'active'; // paid up; it starts later
  } else {
    status = 'expired';
  }
  return { status, currentEndsOn, visitsLeft };
}
