import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

// Mirrors GYM_ROLES in @gym/shared. Task 4 switches this to the shared type once the API depends on it.
export type DbGymRole = 'owner' | 'reception' | 'trainer' | 'member';

/** Gym-owned (RLS on `gym_id`). One row per person, gym and role. */
export const gymRoles = pgTable(
  'gym_roles',
  {
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').$type<DbGymRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.userId, t.role] }),
    index('gym_roles_user_id_idx').on(t.userId),
    check('gym_roles_role_valid', sql`${t.role} in ('owner', 'reception', 'trainer', 'member')`),
  ],
);
