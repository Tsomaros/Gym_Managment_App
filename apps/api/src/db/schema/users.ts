import { type SQL, sql } from 'drizzle-orm';
import { boolean, check, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Global accounts. One row per person, whatever gyms and roles they have. gym_app may only read
 * people with a role in the current gym (RLS, migration 0002); every write goes through systemDb.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    fullName: text('full_name')
      .notNull()
      .generatedAlwaysAs((): SQL => sql`btrim(${users.firstName} || ' ' || ${users.lastName})`),
    phone: text('phone'),
    dateOfBirth: date('date_of_birth'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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
