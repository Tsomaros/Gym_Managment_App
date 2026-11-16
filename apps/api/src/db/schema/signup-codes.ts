import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). One-time sign-up codes reception hands to a new member at the desk:
 * single use, 24-hour expiry, stored as a sha256 hash. Claimed through systemDb at sign-up.
 */
export const signupCodes = pgTable(
  'signup_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    // Nullable so erasing the receptionist's account (GDPR) doesn't block on old codes.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signup_codes_gym_id_created_at_idx').on(t.gymId, t.createdAt.desc())],
);
