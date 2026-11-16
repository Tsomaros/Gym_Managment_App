import { z } from 'zod';

/** Every action the change history records (spec §6.10). */
export const AUDIT_ACTIONS = [
  'signup_code.issued',
  'member.signed_up',
  'invitation.sent',
  'invitation.accepted',
  'membership_type.created',
  'membership_type.updated',
  'membership_type.archived',
  'membership.sold',
  'payment.voided',
  'freeze.created',
  'freeze.ended',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  id: string;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  /** Null when the account that acted has been erased. */
  actor: { id: string; fullName: string } | null;
  data: Record<string, unknown>;
  at: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextBefore: string | null;
}

export const AuditQuerySchema = z.object({
  before: z
    .string()
    .regex(/^[1-9]\d{0,14}$/) // stays below 2^53
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  entity: z.string().min(1).max(50).optional(),
  entityId: z.uuid().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
