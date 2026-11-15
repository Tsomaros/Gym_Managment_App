import { z } from 'zod';
import { GYM_ROLES } from '../roles.js';
import { emailSchema, LOCALES } from './common.js';

export const PASSWORD_MIN_LENGTH = 8;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type Login = z.infer<typeof LoginSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH),
});
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;

export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
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
