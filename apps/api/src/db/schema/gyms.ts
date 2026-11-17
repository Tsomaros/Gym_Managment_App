import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Gym-owned (RLS on `id`). Created only by the platform admin through systemDb. */
export const gyms = pgTable(
  'gyms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Europe/Athens'),
    /** Someone checked in longer ago than this counts as having left (spec §6.2). 30–600. */
    autoCheckoutMinutes: integer('auto_checkout_minutes').notNull().default(120),
    /** Whether reception may edit shifts too (spec §6.3); the owner always may. */
    receptionCanEditShifts: boolean('reception_can_edit_shifts').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('gyms_auto_checkout_valid', sql`${t.autoCheckoutMinutes} between 30 and 600`)],
);
