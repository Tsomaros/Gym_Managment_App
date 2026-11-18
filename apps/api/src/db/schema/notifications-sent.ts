import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). The record that an event reached a person: written only after at
 * least one channel succeeded, so a failed send is retried by the next run. The unique
 * (gym_id, dedupe_key) is the last word on "exactly once"; the service also serialises sends of one
 * key with an advisory lock, so two runs never both send. `gym_app` has no UPDATE or DELETE.
 */
export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    channels: text('channels').array().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notifications_sent_gym_key_uq').on(t.gymId, t.dedupeKey),
    index('notifications_sent_gym_user_idx').on(t.gymId, t.userId),
    check('notifications_sent_channels_chk', sql`cardinality(${t.channels}) between 1 and 2`),
    check('notifications_sent_key_chk', sql`char_length(${t.dedupeKey}) between 1 and 200`),
  ],
);
