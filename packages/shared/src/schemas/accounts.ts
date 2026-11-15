import { z } from 'zod';
import { emailSchema, fullNameSchema, gymRolesSchema, timezoneSchema } from './common.js';

export const CreateGymSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: timezoneSchema.default('Europe/Athens'),
  ownerEmail: emailSchema,
  ownerFullName: fullNameSchema,
});
export type CreateGym = z.infer<typeof CreateGymSchema>;

export const InviteSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  roles: gymRolesSchema,
});
export type Invite = z.infer<typeof InviteSchema>;
