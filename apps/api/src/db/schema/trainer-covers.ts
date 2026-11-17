import { date, index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A trainer who covers a member for one gym date only (spec §6.4).
 * It ends with that date: nothing deletes it, readers compare `date` with the gym's today.
 */
export const trainerCovers = pgTable(
  'trainer_covers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id),
    date: date('date').notNull(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('trainer_covers_member_date_uq').on(t.gymId, t.memberId, t.date),
    index('trainer_covers_gym_trainer_date_idx').on(t.gymId, t.trainerId, t.date),
  ],
);
