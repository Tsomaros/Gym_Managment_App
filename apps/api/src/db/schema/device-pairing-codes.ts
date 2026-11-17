import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). One-time code (XXXX-XXXX, 15 minutes) the owner creates to pair a
 * tablet; stored as a sha256 hash. Claimed through systemDb by the not-yet-signed-in tablet.
 */
export const devicePairingCodes = pgTable(
  'device_pairing_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    name: text('name').notNull(),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_pairing_codes_gym_id_idx').on(t.gymId)],
);
