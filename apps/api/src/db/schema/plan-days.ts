import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { plans } from './plans';

/**
 * Gym-owned (RLS on `gym_id`). A day of an interactive plan. Positions are unique per plan but the
 * check is deferred, so a save may reorder days inside one transaction. Ids stay stable across edits.
 */
export const planDays = pgTable(
  'plan_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    planId: uuid('plan_id').notNull(),
    position: smallint('position').notNull(),
    title: text('title').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'plan_days_plan_gym_fk',
      columns: [t.planId, t.gymId],
      foreignColumns: [plans.id, plans.gymId],
    }).onDelete('cascade'),
    unique('plan_days_id_gym_uq').on(t.id, t.gymId),
    check('plan_days_title_chk', sql`char_length(${t.title}) between 1 and 80`),
    check('plan_days_position_chk', sql`${t.position} between 0 and 13`),
    unique('plan_days_plan_position_uq').on(t.planId, t.position),
  ],
);
