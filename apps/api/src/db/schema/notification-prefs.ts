import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). One row per member and event group, written when the member first
 * changes a switch; a missing row means the defaults (email on, push on).
 */
export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    group: text('group').notNull(),
    email: boolean('email').notNull().default(true),
    push: boolean('push').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.userId, t.group] }),
    check('notification_prefs_group_chk', sql`${t.group} in ('membership', 'plans')`),
  ],
);
