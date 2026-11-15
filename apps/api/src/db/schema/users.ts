import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Global accounts (no RLS). One row per person, whatever gyms and roles they have. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    locale: text('locale').notNull().default('el'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Emails are stored normalised, so the unique constraint is case- and space-insensitive.
    check('users_email_normalised', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_locale_valid', sql`${t.locale} in ('el', 'en')`),
  ],
);
