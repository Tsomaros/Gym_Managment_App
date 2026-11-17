import type { MembershipKind } from '@gym/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';

/**
 * Gym-owned (RLS on `gym_id`). What the owner sells (spec §6.1). Never deleted: archived types stay
 * for history, and memberships keep a snapshot of the type as sold.
 */
export const membershipTypes = pgTable(
  'membership_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    kind: text('kind').$type<MembershipKind>().notNull(),
    durationMonths: integer('duration_months'),
    visitCount: integer('visit_count'),
    validityDays: integer('validity_days'),
    priceCents: integer('price_cents').notNull(),
    maxFreezeDays: integer('max_freeze_days').notNull().default(0),
    includesTrainer: boolean('includes_trainer').notNull().default(false),
    includesClasses: boolean('includes_classes').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('membership_types_gym_id_idx').on(t.gymId),
    // Target of the memberships (type_id, gym_id) foreign key: a type of the same gym only.
    unique('membership_types_id_gym_id_uq').on(t.id, t.gymId),
    check(
      'membership_types_kind_valid',
      sql`${t.kind} in ('time', 'visits', 'day_pass', 'classes')`,
    ),
    check('membership_types_price_valid', sql`${t.priceCents} >= 0`),
    check('membership_types_freeze_valid', sql`${t.maxFreezeDays} between 0 and 365`),
    check(
      'membership_types_time_rules',
      sql`${t.kind} <> 'time' or (${t.durationMonths} between 1 and 36 and ${t.visitCount} is null and ${t.validityDays} is null)`,
    ),
    check(
      'membership_types_pack_rules',
      sql`${t.kind} not in ('visits', 'classes') or (${t.visitCount} between 1 and 500 and (${t.validityDays} is null or ${t.validityDays} between 1 and 730) and ${t.durationMonths} is null and ${t.maxFreezeDays} = 0)`,
    ),
    check(
      'membership_types_day_pass_rules',
      sql`${t.kind} <> 'day_pass' or (${t.durationMonths} is null and ${t.visitCount} is null and ${t.validityDays} is null and ${t.maxFreezeDays} = 0)`,
    ),
    check('membership_types_classes_rules', sql`${t.kind} <> 'classes' or ${t.includesClasses}`),
  ],
);
