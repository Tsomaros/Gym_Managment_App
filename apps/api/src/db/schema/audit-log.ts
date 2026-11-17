import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). Append-only change history (spec §6.10): gym_app may only read and
 * insert. Every entry is written in the same transaction as the change it records.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    // Nullable so erasing an account (GDPR) keeps the history, without the person. That SET NULL
    // is the only change an entry ever sees.
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_gym_id_id_idx').on(t.gymId, t.id.desc()),
    index('audit_log_gym_entity_idx').on(t.gymId, t.entity, t.entityId, t.id.desc()),
  ],
);
