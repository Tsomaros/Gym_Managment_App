import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  check,
  foreignKey,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { exercises } from './exercises';
import { gyms } from './gyms';
import { planDays } from './plan-days';

/**
 * Gym-owned (RLS on `gym_id`). One exercise inside a plan day with its targets. Ids stay stable
 * across edits so phase 4b's workout logs can point at them. The exercise reference is never
 * cascaded: exercises are archived, not deleted.
 */
export const planExercises = pgTable(
  'plan_exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    planDayId: uuid('plan_day_id').notNull(),
    exerciseId: uuid('exercise_id').notNull(),
    position: smallint('position').notNull(),
    sets: smallint('sets').notNull(),
    repsMin: smallint('reps_min'),
    repsMax: smallint('reps_max'),
    toFailure: boolean('to_failure').notNull().default(false),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
    restSeconds: integer('rest_seconds'),
    durationSeconds: integer('duration_seconds'),
    notes: text('notes'),
  },
  (t) => [
    foreignKey({
      name: 'plan_exercises_day_gym_fk',
      columns: [t.planDayId, t.gymId],
      foreignColumns: [planDays.id, planDays.gymId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plan_exercises_exercise_gym_fk',
      columns: [t.exerciseId, t.gymId],
      foreignColumns: [exercises.id, exercises.gymId],
    }),
    // Target of phase 4b's composite foreign key from workout logs.
    unique('plan_exercises_id_gym_uq').on(t.id, t.gymId),
    check('plan_exercises_position_chk', sql`${t.position} between 0 and 29`),
    index('plan_exercises_gym_exercise_idx').on(t.gymId, t.exerciseId),
    unique('plan_exercises_day_position_uq').on(t.planDayId, t.position),
    check('plan_exercises_sets_chk', sql`${t.sets} between 1 and 20`),
    check(
      'plan_exercises_reps_chk',
      sql`(${t.repsMin} is null and ${t.repsMax} is null)
        or (not ${t.toFailure} and ${t.repsMin} is not null and ${t.repsMax} is not null and ${t.repsMin} between 1 and 100 and ${t.repsMax} between 1 and 100 and ${t.repsMin} <= ${t.repsMax})`,
    ),
    check(
      'plan_exercises_weight_chk',
      sql`${t.weightKg} is null or (${t.weightKg} between 0 and 999.75 and ${t.weightKg} * 4 = trunc(${t.weightKg} * 4))`,
    ),
    check(
      'plan_exercises_rest_chk',
      sql`${t.restSeconds} is null or ${t.restSeconds} between 0 and 900`,
    ),
    check(
      'plan_exercises_duration_chk',
      sql`${t.durationSeconds} is null or ${t.durationSeconds} between 1 and 7200`,
    ),
    check('plan_exercises_notes_chk', sql`${t.notes} is null or char_length(${t.notes}) <= 300`),
  ],
);
