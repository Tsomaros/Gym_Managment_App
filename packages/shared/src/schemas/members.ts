import { z } from 'zod';
import type { Freeze, Membership, Payment } from './memberships.js';

/**
 * A member's overall state for reception: `new` (never had a membership), `active`, `frozen`,
 * `expiring` (active, but ending within 7 days or with 2 or fewer visits left, and nothing booked
 * after it) or `expired`.
 */
export const MEMBER_STATUSES = ['new', 'active', 'frozen', 'expiring', 'expired'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface MemberSummary {
  userId: string;
  /** A signed link that works for 5 minutes; null when the member has no photo. */
  photoUrl: string | null;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  joinedAt: string;
  status: MemberStatus;
  /** Latest effective end among current memberships; null when none or none has an end. */
  currentEndsOn: string | null;
  /** Visits left across current visit packs; null when there are none. */
  visitsLeft: number | null;
}

export interface MemberDetail extends MemberSummary {
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /** All memberships, voided included, newest first. */
  memberships: Membership[];
  /** Owner only; reception gets an empty list. */
  payments: Payment[];
  freezes: Freeze[];
}

export interface MyMemberships {
  /** Non-voided, newest first. */
  memberships: Membership[];
}

export const MembersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  /** 'ending': the soonest end first, members without an end last (the renewals list). */
  sort: z.enum(['ending']).optional(),
});
export type MembersQuery = z.infer<typeof MembersQuerySchema>;
