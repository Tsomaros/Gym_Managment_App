import type { Membership } from '@gym/shared';
import { addDays, daysBetweenInclusive } from '../memberships/dates';

export interface ReminderDue {
  memberId: string;
  membershipId: string;
  membershipName: string;
  event: 'membership.expiring' | 'membership.expires_today';
  /** The effective end the reminder is about (part of the dedupe key). */
  endsOn: string;
  /** Days from today to the end; 0 for "expires today". */
  days: number;
}

/**
 * Which memberships need a reminder on `today` (the gym's date): those that end exactly
 * `reminderDays` days from now ("expiring") or today ("expires today"). Only running memberships
 * count (not frozen, voided, upcoming or used up), and not those the member already renewed: a
 * non-voided membership of the same member starting on the end date or the day after.
 */
export function selectReminders(input: {
  today: string;
  reminderDays: number;
  memberships: readonly Membership[];
}): ReminderDue[] {
  const { today, reminderDays, memberships } = input;
  const due: ReminderDue[] = [];
  for (const m of memberships) {
    const end = m.effectiveEndsOn;
    if (m.status !== 'active' || end === null) continue;
    const days = daysBetweenInclusive(today, end) - 1;
    if (days !== 0 && days !== reminderDays) continue;
    const dayAfter = addDays(end, 1);
    const renewed = memberships.some(
      (o) =>
        o.id !== m.id &&
        o.memberId === m.memberId &&
        o.voidedAt === null &&
        (o.startsOn === end || o.startsOn === dayAfter),
    );
    if (renewed) continue;
    due.push({
      memberId: m.memberId,
      membershipId: m.id,
      membershipName: m.name,
      event: days === 0 ? 'membership.expires_today' : 'membership.expiring',
      endsOn: end,
      days,
    });
  }
  return due;
}
