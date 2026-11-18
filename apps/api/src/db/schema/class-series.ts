import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { classTypes } from './class-types';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A weekly class pattern: ISO weekday, gym-local start time,
 * valid from/until (inclusive gym dates). Changing it from a date on ends this series the day
 * before and starts a new one, as with shifts. A job turns it into `class_sessions`.
 */
export const classSeries = pgTable(
  'class_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    classTypeId: uuid('class_type_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startsAt: time('starts_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    capacity: integer('capacity').notNull(),
    // Null once the trainer loses the role: the classes keep running ("χωρίς γυμναστή").
    trainerId: uuid('trainer_id').references(() => users.id),
    room: text('room'),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('class_series_gym_idx').on(t.gymId, t.validUntil),
    unique('class_series_id_gym_uq').on(t.id, t.gymId),
    foreignKey({
      columns: [t.classTypeId, t.gymId],
      foreignColumns: [classTypes.id, classTypes.gymId],
      name: 'class_series_type_same_gym_fk',
    }),
    check('class_series_weekday_valid', sql`${t.weekday} between 1 and 7`),
    check('class_series_duration_valid', sql`${t.durationMinutes} between 15 and 240`),
    check(
      'class_series_ends_before_midnight',
      sql`extract(epoch from ${t.startsAt}) / 60 + ${t.durationMinutes} < 1440`,
    ),
    check('class_series_capacity_valid', sql`${t.capacity} between 1 and 200`),
    check('class_series_room_len', sql`char_length(${t.room}) <= 40`),
    check(
      'class_series_dates_valid',
      sql`${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom} - 1`,
    ),
  ],
);
