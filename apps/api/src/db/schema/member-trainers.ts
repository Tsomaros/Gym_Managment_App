import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A member's primary trainer: at most one per member and gym. Whether
 * the link is paused is computed from the member's memberships, never stored (spec §6.4).
 */
export const memberTrainers = pgTable(
  'member_trainers',
  {
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.memberId] }),
    index('member_trainers_gym_trainer_idx').on(t.gymId, t.trainerId),
  ],
);
