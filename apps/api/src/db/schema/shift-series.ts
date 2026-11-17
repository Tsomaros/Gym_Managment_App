import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  smallint,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A weekly shift pattern for one staff member: ISO weekday
 * (1 = Monday … 7 = Sunday), gym-local times, valid from/until (inclusive gym dates). Editing "from
 * date X" ends the old series at X - 1 and starts a new one, so past dates never change.
 */
export const shiftSeries = pgTable(
  'shift_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => users.id),
    weekday: smallint('weekday').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('shift_series_gym_staff_idx').on(t.gymId, t.staffId),
    unique('shift_series_id_gym_staff_uq').on(t.id, t.gymId, t.staffId),
    check('shift_series_weekday_valid', sql`${t.weekday} between 1 and 7`),
    check('shift_series_times_valid', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'shift_series_dates_valid',
      sql`${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom}`,
    ),
  ],
);
