import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { memberships } from './memberships';
import { users } from './users';

export type PaymentMethod = 'cash' | 'card';

/**
 * Gym-owned (RLS on `gym_id`). Money received for a membership, in euro cents. Never deleted or
 * edited: a mistake is voided by the owner, with a reason (gym_app may update the void columns only).
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    membershipId: uuid('membership_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    amountCents: integer('amount_cents').notNull(),
    method: text('method').$type<PaymentMethod>().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
  },
  (t) => [
    foreignKey({
      columns: [t.membershipId, t.gymId],
      foreignColumns: [memberships.id, memberships.gymId],
      name: 'payments_membership_same_gym_fk',
    }),
    index('payments_gym_member_paid_at_idx').on(t.gymId, t.memberId, t.paidAt.desc()),
    index('payments_gym_paid_at_idx').on(t.gymId, t.paidAt),
    index('payments_membership_id_idx').on(t.membershipId),
    check('payments_amount_valid', sql`${t.amountCents} >= 0`),
    check('payments_method_valid', sql`${t.method} in ('cash', 'card')`),
    check('payments_void_reason', sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
  ],
);
