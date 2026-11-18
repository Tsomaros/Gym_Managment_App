import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';

/** Gym-owned (RLS on `gym_id`). A kind of class (spinning, pilates…); archived, never deleted. */
export const classTypes = pgTable(
  'class_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    description: text('description'),
    defaultCapacity: integer('default_capacity').notNull(),
    defaultDurationMinutes: integer('default_duration_minutes').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('class_types_id_gym_uq').on(t.id, t.gymId),
    check('class_types_capacity_valid', sql`${t.defaultCapacity} between 1 and 200`),
    check('class_types_duration_valid', sql`${t.defaultDurationMinutes} between 15 and 240`),
    check('class_types_description_len', sql`char_length(${t.description}) <= 500`),
  ],
);
