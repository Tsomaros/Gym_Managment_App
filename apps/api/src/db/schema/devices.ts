import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A paired kiosk tablet. It authenticates with a long-lived random
 * token of which only the sha256 is stored; the owner can revoke it. Rows are created through
 * systemDb at pairing (no gym context yet); gym_app can only read them and set `revoked_at`.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('devices_gym_id_idx').on(t.gymId), unique('devices_id_gym_id_uq').on(t.id, t.gymId)],
);
