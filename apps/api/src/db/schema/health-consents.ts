import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A member's explicit consent to store a kind of health data
 * (`measurements`, `photos`). Withdrawing sets `withdrawn_at` and keeps the row as evidence, so
 * `gym_app` has no DELETE and may update only `withdrawn_at`. Re-granting after a withdrawal is a
 * new row: the partial unique index allows one *active* consent per member and kind.
 * `member_id` is a plain FK to `users` (not gym-scoped): the service must check the member's role.
 */
export const healthConsents = pgTable(
  'health_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    /** Version of the consent text the member saw (e.g. '2026-11'). */
    textVersion: text('text_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    check('health_consents_kind_chk', sql`${t.kind} in ('measurements', 'photos')`),
    check('health_consents_text_version_chk', sql`char_length(${t.textVersion}) between 1 and 20`),
    check(
      'health_consents_withdrawn_chk',
      sql`${t.withdrawnAt} is null or ${t.withdrawnAt} >= ${t.grantedAt}`,
    ),
    uniqueIndex('health_consents_active_uq')
      .on(t.gymId, t.memberId, t.kind)
      .where(sql`${t.withdrawnAt} is null`),
    index('health_consents_gym_member_idx').on(t.gymId, t.memberId),
  ],
);
