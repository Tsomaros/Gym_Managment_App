import { z } from 'zod';
import { isoDateSchema } from './common.js';

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

export const PAYMENT_METHODS = ['cash', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const MEMBERSHIP_STATUSES = [
  'voided',
  'upcoming',
  'frozen',
  'active',
  'used_up',
  'expired',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Reception sells a type to a member and records the payment (spec §6.1). */
export const SellMembershipSchema = z.object({
  typeId: z.uuid(),
  /** Optional future start; default: today, or the day after the current time-based one ends. */
  startsOn: isoDateSchema.optional(),
  /** What was actually paid: the type's price, or less for a discount. */
  amountCents: z.number().int().min(0).max(10_000_000),
  method: z.enum(PAYMENT_METHODS),
});
export type SellMembership = z.infer<typeof SellMembershipSchema>;

/** A sold membership: the type as it was at sale time, with its state today. */
export interface Membership {
  id: string;
  memberId: string;
  typeId: string;
  name: string;
  kind: MembershipKind;
  includesTrainer: boolean;
  includesClasses: boolean;
  maxFreezeDays: number;
  priceCents: number;
  startsOn: string;
  /** End of the paid period, before freezes; null when it has none. */
  endsOn: string | null;
  /** End including frozen days. */
  effectiveEndsOn: string | null;
  visitsTotal: number | null;
  visitsUsed: number;
  voidedAt: string | null;
  status: MembershipStatus;
  remaining: { days: number | null; visits: number | null };
  createdAt: string;
}

export interface Payment {
  id: string;
  membershipId: string;
  membershipName: string;
  memberId: string;
  memberName: string;
  amountCents: number;
  method: PaymentMethod;
  paidAt: string;
  recordedBy: { id: string; fullName: string } | null;
  voidedAt: string | null;
  voidedBy: { id: string; fullName: string } | null;
  voidReason: string | null;
}

export const VoidPaymentSchema = z.object({ reason: z.string().trim().min(3).max(200) });
export type VoidPayment = z.infer<typeof VoidPaymentSchema>;

/** Days in the gym's time zone, both included. */
export const PaymentsQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to' })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < 366, {
    message: 'At most 366 days per request (both ends included)',
  });
export type PaymentsQuery = z.infer<typeof PaymentsQuerySchema>;

/** Reception pauses a time-based membership; days in the gym's time zone, both included. */
export const CreateFreezeSchema = z
  .object({ startsOn: isoDateSchema, endsOn: isoDateSchema })
  .refine((f) => f.startsOn <= f.endsOn, { message: 'The freeze ends before it starts' });
export type CreateFreeze = z.infer<typeof CreateFreezeSchema>;

export interface Freeze {
  id: string;
  membershipId: string;
  startsOn: string;
  endsOn: string;
  /** True when a running freeze was ended before its planned end. */
  endedEarly: boolean;
  createdAt: string;
}
