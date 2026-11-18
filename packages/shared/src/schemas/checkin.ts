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

export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 2000;

export const AUTO_CHECKOUT_MIN = 30;
export const AUTO_CHECKOUT_MAX = 600;

export const UpdateGymSettingsSchema = z
  .object({
    autoCheckoutMinutes: z.number().int().min(AUTO_CHECKOUT_MIN).max(AUTO_CHECKOUT_MAX).optional(),
    receptionCanEditShifts: z.boolean().optional(),
    reminderDays: z.number().int().min(REMINDER_DAYS_MIN).max(REMINDER_DAYS_MAX).optional(),
    /** null clears it: members then see no occupancy. */
    capacity: z.number().int().min(CAPACITY_MIN).max(CAPACITY_MAX).nullable().optional(),
    showOccupancyCount: z.boolean().optional(),
    /** Minutes before a class that a member can still cancel without losing a class-pack entry. */
    classCancelCutoffMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .refine(
    (s) =>
      s.autoCheckoutMinutes !== undefined ||
      s.receptionCanEditShifts !== undefined ||
      s.reminderDays !== undefined ||
      s.capacity !== undefined ||
      s.showOccupancyCount !== undefined ||
      s.classCancelCutoffMinutes !== undefined,
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
  /** How many people fit at once; null when the owner has not said. */
  capacity: number | null;
  /** Whether members see the number inside, not only the level. */
  showOccupancyCount: boolean;
  /** Cancelling later than this before a class start counts as a late cancellation. */
  classCancelCutoffMinutes: number;
}

export type OccupancyLevel = 'quiet' | 'moderate' | 'busy';

/**
 * How busy the gym is right now. Without a capacity there is no level (null). Members get the
 * count and capacity only when the owner allowed it; staff always get the count.
 */
export type Occupancy =
  { level: OccupancyLevel; count?: number; capacity?: number } | { level: null; count?: number };

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
  /** Set when this check-in was for (or also covered) a booked class, which is now marked attended. */
  classBooking?: { sessionId: string; typeName: string; startsAt: string };
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
