import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Global (no RLS; gym_app has no access). Email confirmation links: single use, 72-hour expiry,
 * token stored as a sha256 hash. Reached only through systemDb.
 */
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_verifications_user_id_idx').on(t.userId)],
);
