import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). The gym's exercise library. Archive-only (no DELETE grant), so
 * plans and logs that point at an exercise never dangle. Names are unique per gym ignoring case.
 */
export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    nameEl: text('name_el').notNull(),
    nameEn: text('name_en'),
    muscleGroup: text('muscle_group').notNull(),
    measure: text('measure').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('exercises_gym_name_el_uq').on(t.gymId, sql`lower(${t.nameEl})`)],
);
