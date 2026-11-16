import type { MembershipKind } from '@gym/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { membershipTypes } from './membership-types';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A membership sold to a member. Name, kind, rules and price are a
 * snapshot of the type at sale time, so editing or archiving the type never changes it.
 * Dates are calendar days in the gym's time zone, end dates inclusive. `ends_on` is the effective
 * end (base end plus frozen days), kept up to date by freezes.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    typeId: uuid('type_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<MembershipKind>().notNull(),
    includesTrainer: boolean('includes_trainer').notNull().default(false),
    includesClasses: boolean('includes_classes').notNull().default(false),
    maxFreezeDays: integer('max_freeze_days').notNull().default(0),
    priceCents: integer('price_cents').notNull(),
    startsOn: date('starts_on').notNull(),
    baseEndsOn: date('base_ends_on'),
    endsOn: date('ends_on'),
    visitsTotal: integer('visits_total'),
    visitsUsed: integer('visits_used').notNull().default(0),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    // Nullable so erasing the receptionist's account (GDPR) keeps the membership.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The type must belong to the same gym; RLS hides rows but doesn't stop a cross-gym reference.
    foreignKey({
      columns: [t.typeId, t.gymId],
      foreignColumns: [membershipTypes.id, membershipTypes.gymId],
      name: 'memberships_type_same_gym_fk',
    }),
    unique('memberships_id_gym_id_uq').on(t.id, t.gymId),
    index('memberships_gym_member_idx').on(t.gymId, t.memberId),
    check('memberships_kind_valid', sql`${t.kind} in ('time', 'visits', 'day_pass', 'classes')`),
    check('memberships_price_valid', sql`${t.priceCents} >= 0`),
    check(
      'memberships_kind_rules',
      sql`(${t.kind} <> 'time' or ${t.baseEndsOn} is not null) and (${t.kind} = 'time' or ${t.visitsTotal} is not null)`,
    ),
    check(
      'memberships_visits_valid',
      sql`${t.visitsUsed} >= 0 and (${t.visitsTotal} is null or ${t.visitsUsed} <= ${t.visitsTotal})`,
    ),
    check(
      'memberships_dates_valid',
      sql`(${t.baseEndsOn} is null or ${t.baseEndsOn} >= ${t.startsOn}) and (${t.endsOn} is null) = (${t.baseEndsOn} is null) and (${t.endsOn} is null or ${t.endsOn} >= ${t.baseEndsOn})`,
    ),
  ],
);
