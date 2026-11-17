import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { devices } from './devices';
import { gyms } from './gyms';
import { memberships } from './memberships';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). Every check-in attempt of a member, valid or not (spec §6.2);
 * kiosk and manual alike. Append-only except check-out: gym_app can only set the check-out columns.
 */
export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    method: text('method').$type<'kiosk' | 'manual'>().notNull(),
    deviceId: uuid('device_id'),
    byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
    valid: boolean('valid').notNull(),
    reason: text('reason'),
    membershipId: uuid('membership_id'),
    visitConsumed: boolean('visit_consumed').notNull().default(false),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    checkedOutBy: uuid('checked_out_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // The device and membership must belong to the same gym; RLS hides rows but doesn't stop
    // a cross-gym reference.
    foreignKey({
      columns: [t.deviceId, t.gymId],
      foreignColumns: [devices.id, devices.gymId],
      name: 'check_ins_device_same_gym_fk',
    }),
    foreignKey({
      columns: [t.membershipId, t.gymId],
      foreignColumns: [memberships.id, memberships.gymId],
      name: 'check_ins_membership_same_gym_fk',
    }),
    check('check_ins_method_valid', sql`${t.method} in ('kiosk', 'manual')`),
    check('check_ins_reason_matches_valid', sql`${t.valid} = (${t.reason} is null)`),
    check(
      'check_ins_visit_consumed_valid',
      sql`not ${t.visitConsumed} or (${t.valid} and ${t.membershipId} is not null)`,
    ),
    check('check_ins_kiosk_has_device', sql`${t.method} <> 'kiosk' or ${t.deviceId} is not null`),
    // Ascending on purpose: a backward scan serves ORDER BY at DESC (the DESC NULLS LAST
    // that drizzle would emit for .desc() does not match Postgres's DESC NULLS FIRST).
    index('check_ins_gym_id_at_idx').on(t.gymId, t.at),
    index('check_ins_gym_id_member_id_at_idx').on(t.gymId, t.memberId, t.at),
  ],
);
