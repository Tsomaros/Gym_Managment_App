import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Gym-owned (RLS on `id`). Created only by the platform admin through systemDb. */
export const gyms = pgTable('gyms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Athens'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
