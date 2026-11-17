import { z } from 'zod';
import { isoDateSchema } from './common.js';
import type { MemberStatus } from './members.js';
import type { Membership } from './memberships.js';

/** Why a check-in was refused, in the order they are tried (spec §6.2). */
export const CHECK_IN_REASONS = [
  'frozen',
  'upcoming_only',
  'classes_only',
  'used_up',
  'expired',
  'no_membership',
] as const;
export type CheckInReason = (typeof CHECK_IN_REASONS)[number];

export const AUTO_CHECKOUT_MIN = 30;
export const AUTO_CHECKOUT_MAX = 600;

export const UpdateGymSettingsSchema = z.object({
  autoCheckoutMinutes: z.number().int().min(AUTO_CHECKOUT_MIN).max(AUTO_CHECKOUT_MAX),
});
export type UpdateGymSettings = z.infer<typeof UpdateGymSettingsSchema>;

export interface GymSettings {
  name: string;
  timezone: string;
  autoCheckoutMinutes: number;
}

/** The member's rotating QR payload and when it stops being accepted. */
export interface CheckInTokenResponse {
  token: string;
  expiresAt: string;
}

export const KioskCheckInSchema = z.object({ token: z.string().max(1000) });
export type KioskCheckIn = z.infer<typeof KioskCheckInSchema>;

/** What reception sees for one check-in attempt, valid or not. */
export interface CheckInResult {
  /** Null only when nothing was recorded. */
  checkInId: string | null;
  valid: boolean;
  reason: CheckInReason | null;
  /** True when this repeats a check-in from the last 2 minutes: nothing new was recorded. */
  duplicate: boolean;
  member: { id: string; firstName: string; lastName: string; photoUrl: string | null };
  /** The membership used, or for a refusal the one that explains it. */
  membership: Membership | null;
  at: string;
}

/** What the tablet gets: a first name and pass/fail, nothing else about the member. */
export interface KioskCheckInResult {
  valid: boolean;
  firstName: string | null;
  reason: 'invalid_token' | 'not_member' | CheckInReason | null;
}

/** Someone inside the gym right now (spec §6.2). */
export interface PresentMember {
  checkInId: string;
  memberId: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  at: string;
  membershipStatus: MemberStatus;
}

/** One line of a day's visitors, refused attempts included. */
export interface VisitorRow {
  checkInId: string;
  memberId: string;
  firstName: string;
  lastName: string;
  at: string;
  method: 'kiosk' | 'manual';
  valid: boolean;
  reason: CheckInReason | null;
  checkedOutAt: string | null;
}

export const VisitorsQuerySchema = z.object({ date: isoDateSchema.optional() });
export type VisitorsQuery = z.infer<typeof VisitorsQuerySchema>;

/** Pushed to reception and trainer screens over the live stream. */
export type LiveEvent =
  | { type: 'check_in'; result: CheckInResult }
  | { type: 'check_out'; checkInId: string };

export interface LiveTicketResponse {
  ticket: string;
}
