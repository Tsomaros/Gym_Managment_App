import { z } from 'zod';
import { GYM_ROLES } from '../roles.js';
import { emailSchema, LOCALES } from './common.js';

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
