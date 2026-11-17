import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { shiftSeries } from './shift-series';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A dated shift: a one-off (`series_id` null) or the override of one
 * occurrence of a series on `date` (other times, or `cancelled`). Times are gym-local.
 */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => users.id),
    date: date('date').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    seriesId: uuid('series_id'),
    cancelled: boolean('cancelled').notNull().default(false),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('shifts_gym_staff_date_idx').on(t.gymId, t.staffId, t.date),
    index('shifts_gym_date_idx').on(t.gymId, t.date),
    // The series must belong to the same gym and staff member; RLS hides rows but doesn't stop a cross-gym reference.
    foreignKey({
      columns: [t.seriesId, t.gymId, t.staffId],
      foreignColumns: [shiftSeries.id, shiftSeries.gymId, shiftSeries.staffId],
      name: 'shifts_series_same_gym_staff_fk',
    }),
    // One override per series occurrence (NULL series_id: one-offs are not constrained).
    unique('shifts_series_date_uq').on(t.seriesId, t.date),
    check('shifts_times_valid', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
