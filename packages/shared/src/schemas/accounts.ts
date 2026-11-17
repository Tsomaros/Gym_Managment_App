import { z } from 'zod';
import { emailSchema, gymRolesSchema, personNameSchema, timezoneSchema } from './common.js';

export const CreateGymSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: timezoneSchema.default('Europe/Athens'),
  ownerEmail: emailSchema,
  ownerFirstName: personNameSchema,
  ownerLastName: personNameSchema,
});
export type CreateGym = z.infer<typeof CreateGymSchema>;

export const InviteSchema = z.object({
  email: emailSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  roles: gymRolesSchema,
});
export type Invite = z.infer<typeof InviteSchema>;
