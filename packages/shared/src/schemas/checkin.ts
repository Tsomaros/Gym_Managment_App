import { z } from 'zod';

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
