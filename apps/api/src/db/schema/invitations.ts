import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { DbGymRole } from './gym-roles';
import { gyms } from './gyms';
import { users } from './users';

/** Gym-owned (RLS on `gym_id`). Single use, 72-hour expiry, token stored as a sha256 hash. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    roles: text('roles').array().$type<DbGymRole[]>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    // Nullable so erasing the inviter's account (GDPR) doesn't block on old invitations.
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invitations_gym_id_idx').on(t.gymId),
    // One pending invitation per gym and email; "resend" upserts onto it, invalidating the old token.
    uniqueIndex('invitations_pending_gym_email_uq')
      .on(t.gymId, t.email)
      .where(sql`${t.acceptedAt} is null`),
    check('invitations_email_normalised', sql`${t.email} = lower(btrim(${t.email}))`),
    check(
      'invitations_roles_valid',
      sql`cardinality(${t.roles}) > 0 and ${t.roles} <@ array['owner', 'reception', 'trainer', 'member']::text[]`,
    ),
  ],
);
