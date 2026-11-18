import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { classSeries } from './class-series';
import { classTypes } from './class-types';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). One concrete class on one date. `starts_at`/`ends_at` are gym-local,
 * the `_utc` columns are the same instants computed from the gym time zone when the row was made;
 * jobs compare those with "now". A cancelled session stays as a row so the job never recreates it.
 */
export const classSessions = pgTable(
  'class_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    classTypeId: uuid('class_type_id').notNull(),
    seriesId: uuid('series_id'),
    date: date('date').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    startsAtUtc: timestamp('starts_at_utc', { withTimezone: true }).notNull(),
    endsAtUtc: timestamp('ends_at_utc', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    trainerId: uuid('trainer_id').references(() => users.id),
    room: text('room'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('class_sessions_id_gym_uq').on(t.id, t.gymId),
    unique('class_sessions_series_date_uq').on(t.seriesId, t.date),
    index('class_sessions_gym_date_idx').on(t.gymId, t.date),
    index('class_sessions_gym_starts_idx').on(t.gymId, t.startsAtUtc),
    foreignKey({
      columns: [t.classTypeId, t.gymId],
      foreignColumns: [classTypes.id, classTypes.gymId],
      name: 'class_sessions_type_same_gym_fk',
    }),
    foreignKey({
      columns: [t.seriesId, t.gymId],
      foreignColumns: [classSeries.id, classSeries.gymId],
      name: 'class_sessions_series_same_gym_fk',
    }),
    check('class_sessions_times_valid', sql`${t.endsAt} > ${t.startsAt}`),
    check('class_sessions_utc_valid', sql`${t.endsAtUtc} > ${t.startsAtUtc}`),
    check('class_sessions_capacity_valid', sql`${t.capacity} between 1 and 200`),
    check('class_sessions_room_len', sql`char_length(${t.room}) <= 40`),
  ],
);
