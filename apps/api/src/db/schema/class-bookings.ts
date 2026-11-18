import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BookingStatus } from '@gym/shared';
import { classSessions } from './class-sessions';
import { gyms } from './gyms';
import { memberships } from './memberships';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). One member's place in one class session. `membership_id` is the
 * membership that pays; when it is a class pack the entry is reserved while `booked` and consumed
 * (once, tracked by `entry_consumed`) on attendance, late cancellation or no-show.
 */
export const classBookings = pgTable(
  'class_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    sessionId: uuid('session_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    membershipId: uuid('membership_id'),
    status: text('status').$type<BookingStatus>().notNull().default('booked'),
    entryConsumed: boolean('entry_consumed').notNull().default(false),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    markedBy: uuid('marked_by').references(() => users.id, { onDelete: 'set null' }),
    bookedBy: uuid('booked_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    foreignKey({
      columns: [t.sessionId, t.gymId],
      foreignColumns: [classSessions.id, classSessions.gymId],
      name: 'class_bookings_session_same_gym_fk',
    }),
    foreignKey({
      columns: [t.membershipId, t.gymId],
      foreignColumns: [memberships.id, memberships.gymId],
      name: 'class_bookings_membership_same_gym_fk',
    }),
    // One live booking per member per session; cancelled ones don't count, so rebooking works.
    uniqueIndex('class_bookings_session_member_live_uq')
      .on(t.sessionId, t.memberId)
      .where(sql`${t.status} in ('booked', 'attended')`),
    index('class_bookings_gym_member_status_idx').on(t.gymId, t.memberId, t.status),
    index('class_bookings_session_idx').on(t.sessionId),
    // Counts of reserved entries per pack, and the index the same-gym foreign key needs.
    index('class_bookings_membership_idx')
      .on(t.membershipId, t.gymId)
      .where(sql`${t.status} = 'booked'`),
    check(
      'class_bookings_cancelled_at_set',
      sql`${t.status} not in ('cancelled', 'late_cancelled') or ${t.cancelledAt} is not null`,
    ),
    check(
      'class_bookings_attended_at_set',
      sql`${t.status} <> 'attended' or ${t.attendedAt} is not null`,
    ),
    check(
      'class_bookings_consumed_has_membership',
      sql`not ${t.entryConsumed} or ${t.membershipId} is not null`,
    ),
    check(
      'class_bookings_status_valid',
      sql`${t.status} in ('booked', 'attended', 'no_show', 'cancelled', 'late_cancelled')`,
    ),
  ],
);
