import { z } from 'zod';

/** Time-based, visit pack, day pass, class pack (spec §6.1). */
export const MEMBERSHIP_KINDS = ['time', 'visits', 'day_pass', 'classes'] as const;
export type MembershipKind = (typeof MEMBERSHIP_KINDS)[number];

const typeName = z.string().trim().min(1).max(80);
/** Up to €100,000 in cents: a typo guard, not a business rule. */
const priceCents = z.number().int().min(0).max(10_000_000);

const common = {
  name: typeName,
  /** Optional English name; the Greek `name` is shown when it is missing. */
  nameEn: typeName.nullable().default(null),
  priceCents,
  includesTrainer: z.boolean().default(false),
};

const visitRules = {
  visitCount: z.number().int().min(1).max(500),
  /** Days the pack stays valid from its start; null means no expiry. */
  validityDays: z.number().int().min(1).max(730).nullable().default(null),
  maxFreezeDays: z.literal(0).default(0),
};

/**
 * What the owner sends to create or edit a type. The rules match the table's CHECK constraints:
 * only time-based types can be frozen, and a class pack always includes group classes.
 */
export const MembershipTypeInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('time'),
    ...common,
    durationMonths: z.number().int().min(1).max(36),
    maxFreezeDays: z.number().int().min(0).max(365).default(0),
    includesClasses: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('visits'),
    ...common,
    ...visitRules,
    includesClasses: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('classes'),
    ...common,
    ...visitRules,
    includesClasses: z.literal(true),
  }),
  z.object({
    kind: z.literal('day_pass'),
    ...common,
    maxFreezeDays: z.literal(0).default(0),
    includesClasses: z.boolean().default(false),
  }),
]);
export type MembershipTypeInput = z.infer<typeof MembershipTypeInputSchema>;

/** A membership type as the API returns it: every rule present, null where it doesn't apply. */
export interface MembershipType {
  id: string;
  name: string;
  nameEn: string | null;
  kind: MembershipKind;
  durationMonths: number | null;
  visitCount: number | null;
  validityDays: number | null;
  priceCents: number;
  maxFreezeDays: number;
  includesTrainer: boolean;
  includesClasses: boolean;
  archived: boolean;
}

export const MembershipTypeListQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
