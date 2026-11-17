import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). The one photo of a member in a gym: only the object key in the
 * object store is kept here, never a link. Photos are served through signed, expiring links
 * (GDPR); the member's consent is given at sign-up on the desk.
 */
export const memberPhotos = pgTable(
  'member_photos',
  {
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    objectKey: text('object_key').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.gymId, t.memberId] })],
);
