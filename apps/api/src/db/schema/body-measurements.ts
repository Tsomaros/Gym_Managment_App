import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). Health data: recorded only under an active `measurements` consent
 * (service-checked). Rows are immutable (`gym_app` has no UPDATE; correct = delete + re-record);
 * DELETE exists for withdrawal and for a trainer removing a row. `member_id` is a plain FK to
 * `users`: the service must verify the member's role in the gym. "measured_on <= today" depends on
 * the gym timezone, so it is checked in the service. `recorded_by` is `ON DELETE SET NULL`.
 */
export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    measuredOn: date('measured_on').notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
    bodyFatPct: numeric('body_fat_pct', { precision: 4, scale: 1 }),
    waistCm: numeric('waist_cm', { precision: 4, scale: 1 }),
    hipsCm: numeric('hips_cm', { precision: 4, scale: 1 }),
    chestCm: numeric('chest_cm', { precision: 4, scale: 1 }),
    armCm: numeric('arm_cm', { precision: 4, scale: 1 }),
    thighCm: numeric('thigh_cm', { precision: 4, scale: 1 }),
    notes: text('notes'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'body_measurements_weight_chk',
      sql`${t.weightKg} is null or ${t.weightKg} between 20 and 400`,
    ),
    check(
      'body_measurements_body_fat_chk',
      sql`${t.bodyFatPct} is null or ${t.bodyFatPct} between 2 and 70`,
    ),
    check(
      'body_measurements_waist_chk',
      sql`${t.waistCm} is null or ${t.waistCm} between 10 and 300`,
    ),
    check('body_measurements_hips_chk', sql`${t.hipsCm} is null or ${t.hipsCm} between 10 and 300`),
    check(
      'body_measurements_chest_chk',
      sql`${t.chestCm} is null or ${t.chestCm} between 10 and 300`,
    ),
    check('body_measurements_arm_chk', sql`${t.armCm} is null or ${t.armCm} between 10 and 300`),
    check(
      'body_measurements_thigh_chk',
      sql`${t.thighCm} is null or ${t.thighCm} between 10 and 300`,
    ),
    check('body_measurements_notes_chk', sql`${t.notes} is null or char_length(${t.notes}) <= 300`),
    check(
      'body_measurements_any_value_chk',
      sql`num_nonnulls(${t.weightKg}, ${t.bodyFatPct}, ${t.waistCm}, ${t.hipsCm}, ${t.chestCm}, ${t.armCm}, ${t.thighCm}) >= 1`,
    ),
    index('body_measurements_gym_member_measured_idx').on(t.gymId, t.memberId, t.measuredOn.desc()),
  ],
);
