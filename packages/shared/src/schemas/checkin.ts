import { z } from 'zod';
import { isoDateSchema } from './common.js';
import { REMINDER_DAYS_MAX, REMINDER_DAYS_MIN } from './notifications.js';
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

export const UpdateGymSettingsSchema = z
  .object({
    autoCheckoutMinutes: z.number().int().min(AUTO_CHECKOUT_MIN).max(AUTO_CHECKOUT_MAX).optional(),
    receptionCanEditShifts: z.boolean().optional(),
    reminderDays: z.number().int().min(REMINDER_DAYS_MIN).max(REMINDER_DAYS_MAX).optional(),
  })
  .refine(
    (s) =>
      s.autoCheckoutMinutes !== undefined ||
      s.receptionCanEditShifts !== undefined ||
      s.reminderDays !== undefined,
    { message: 'Nothing to change' },
  );
export type UpdateGymSettings = z.infer<typeof UpdateGymSettingsSchema>;

export interface GymSettings {
  name: string;
  timezone: string;
  autoCheckoutMinutes: number;
  /** Whether reception may edit shifts too; the owner always may. */
  receptionCanEditShifts: boolean;
  /** Days before the end that the "expiring" reminder is sent. */
  reminderDays: number;
}

/** The member's rotating QR payload and when it stops being accepted. */
export interface CheckInTokenResponse {
  token: string;
  expiresAt: string;
}

export const KioskCheckInSchema = z.object({ token: z.string().max(1000) });
export type KioskCheckIn = z.infer<typeof KioskCheckInSchema>;

/** The membership as the live screens see it: no price (trainers get the stream too). */
export type CheckInMembership = Omit<Membership, 'priceCents'>;

/** What reception sees for one check-in attempt, valid or not. */
export interface CheckInResult {
  /** Null only when nothing was recorded. */
  checkInId: string | null;
  valid: boolean;
  reason: CheckInReason | null;
  /** True when this repeats a check-in from the last 2 minutes: nothing new was recorded. */
  duplicate: boolean;
  method: 'kiosk' | 'manual';
  member: { id: string; firstName: string; lastName: string; photoUrl: string | null };
  /** The membership used, or for a refusal the one that explains it. */
  membership: CheckInMembership | null;
  at: string;
  /** The member's primary trainer and whether they are on duty right now; null without one. */
  trainer: { userId: string; firstName: string; onDuty: boolean } | null;
  /** Today's cover trainer, if reception assigned one. */
  cover: { trainerId: string; firstName: string } | null;
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
  { type: 'check_in'; result: CheckInResult } | { type: 'check_out'; checkInId: string };

export interface LiveTicketResponse {
  ticket: string;
}
