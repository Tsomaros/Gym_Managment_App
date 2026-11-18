import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). Health data: uploaded only under an active `photos` consent
 * (service-checked). Rows are immutable (`gym_app` has no UPDATE); DELETE serves withdrawal (the
 * service deletes the member's rows in one transaction, then the objects after commit) and removal
 * of a single photo. `object_key` points at the file in object storage and is globally unique
 * (it embeds a random uuid), which also makes orphan clean-up lookups an index hit. `member_id` is a
 * plain FK to `users`: the service must verify the member's role in the gym. A per-member photo
 * cap and "taken_on <= today" (gym timezone) are checked in the service. `uploaded_by` is
 * `ON DELETE SET NULL`.
 */
export const progressPhotos = pgTable(
  'progress_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    takenOn: date('taken_on').notNull(),
    objectKey: text('object_key').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('progress_photos_object_key_chk', sql`char_length(${t.objectKey}) between 1 and 300`),
    uniqueIndex('progress_photos_object_key_uq').on(t.objectKey),
    index('progress_photos_gym_member_taken_idx').on(
      t.gymId,
      t.memberId,
      t.takenOn.desc(),
      t.createdAt.desc(),
    ),
  ],
);
