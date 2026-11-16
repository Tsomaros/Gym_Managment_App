import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { memberships } from './memberships';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A pause of a time-based membership: calendar days in the gym's
 * time zone, both ends included. Each frozen day moves the membership's end forward by one.
 */
export const membershipFreezes = pgTable(
  'membership_freezes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    membershipId: uuid('membership_id').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a running freeze is ended before its planned end (ends_on then becomes yesterday). */
    endedEarlyAt: timestamp('ended_early_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.gymId],
      foreignColumns: [memberships.id, memberships.gymId],
      name: 'membership_freezes_membership_same_gym_fk',
    }),
    index('membership_freezes_membership_id_idx').on(t.membershipId),
    index('membership_freezes_gym_id_idx').on(t.gymId),
    check('membership_freezes_dates_valid', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);
