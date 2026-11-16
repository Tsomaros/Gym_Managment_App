import { z } from 'zod';
import { GYM_ROLES } from '../roles.js';
import {
  dateOfBirthSchema,
  emailSchema,
  LOCALES,
  personNameSchema,
  phoneSchema,
} from './common.js';

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound so a huge password cannot be used to burn argon2 CPU. */
export const PASSWORD_MAX_LENGTH = 256;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type Login = z.infer<typeof LoginSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;

/** What the invite page shows before accepting. accountExists → no password field, sign in after. */
export interface InvitePreview {
  gymName: string;
  fullName: string;
  email: string;
  accountExists: boolean;
}

/** New account: signed in. Existing account: roles added, sign in with the existing password. */
export type AcceptInviteResponse = { accessToken: string } | { signInRequired: true };

export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  emailVerified: z.boolean(),
  locale: z.enum(LOCALES),
  isPlatformAdmin: z.boolean(),
  gyms: z.array(
    z.object({
      gymId: z.uuid(),
      gymName: z.string(),
      roles: z.array(z.enum(GYM_ROLES)),
    }),
  ),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Member self sign-up with a one-time code from reception (spec §6.0). */
export const SignupSchema = z.object({
  /** As typed: any case, with or without the dash. The API normalises it. */
  code: z.string().trim().min(1).max(20),
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  dateOfBirth: dateOfBirthSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  emergencyContactName: personNameSchema.optional(),
  emergencyContactPhone: phoneSchema.optional(),
  acceptPrivacy: z.literal(true),
});
export type Signup = z.infer<typeof SignupSchema>;

/** New account: signed in. Existing account: member role added, sign in with the existing password. */
export type SignupResponse = { accessToken: string } | { signInRequired: true };

export const VerifyEmailSchema = z.object({ token: z.string().min(1).max(200) });
export type VerifyEmail = z.infer<typeof VerifyEmailSchema>;

export interface SignupCodeResponse {
  /** XXXX-XXXX */
  code: string;
  expiresAt: string;
}
