import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { gyms } from './gyms';
import { users } from './users';

/**
 * Gym-owned (RLS on `gym_id`). A workout plan: a member's (interactive or PDF) or a template
 * (`member_id` NULL, interactive, always a draft). Plans are never deleted, only archived;
 * only templates can be deleted (a restrictive RLS policy enforces it).
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gymId: uuid('gym_id')
      .notNull()
      .references(() => gyms.id),
    memberId: uuid('member_id').references(() => users.id),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    isTemplate: boolean('is_template').notNull().default(false),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status').notNull(),
    pdfObjectKey: text('pdf_object_key'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Target of the composite foreign keys that keep days in the plan's own gym.
    unique('plans_id_gym_uq').on(t.id, t.gymId),
    check('plans_title_chk', sql`char_length(${t.title}) between 1 and 80`),
    check('plans_notes_chk', sql`${t.notes} is null or char_length(${t.notes}) <= 1000`),
    check('plans_pdf_key_nonempty_chk', sql`${t.pdfObjectKey} is null or ${t.pdfObjectKey} <> ''`),
    check(
      'plans_status_ts_chk',
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null) and (${t.status} <> 'active' or ${t.activatedAt} is not null)`,
    ),
    check('plans_kind_chk', sql`${t.kind} in ('interactive', 'pdf')`),
    check('plans_status_chk', sql`${t.status} in ('draft', 'active', 'archived')`),
    check('plans_template_chk', sql`${t.isTemplate} = (${t.memberId} is null)`),
    check('plans_template_kind_chk', sql`not ${t.isTemplate} or ${t.kind} = 'interactive'`),
    check('plans_template_status_chk', sql`not ${t.isTemplate} or ${t.status} = 'draft'`),
    check('plans_pdf_key_chk', sql`(${t.kind} = 'pdf') = (${t.pdfObjectKey} is not null)`),
    uniqueIndex('plans_one_active_per_member_uq')
      .on(t.gymId, t.memberId)
      .where(sql`${t.status} = 'active' and ${t.memberId} is not null`),
    index('plans_gym_member_idx').on(t.gymId, t.memberId),
    index('plans_gym_template_idx')
      .on(t.gymId)
      .where(sql`${t.isTemplate}`),
  ],
);
