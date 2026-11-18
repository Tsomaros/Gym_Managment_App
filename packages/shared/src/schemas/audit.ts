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
  'gym.settings_updated',
  'device.paired',
  'device.revoked',
  'check_in.manual',
  'check_in.checked_out',
  'member.photo_updated',
  'member.photo_removed',
  'staff.role_removed',
  'invitation.cancelled',
  'shift_series.created',
  'shift_series.ended',
  'shift.created',
  'shift.updated',
  'shift.cancelled',
  'class_type.created',
  'class_type.updated',
  'class_type.archived',
  'class_series.created',
  'class_series.ended',
  'class_session.created',
  'class_session.cancelled',
  'booking.cancelled_by_staff',
  'attendance.marked',
  'trainer.assigned',
  'trainer.unassigned',
  'cover.assigned',
  'cover.removed',
  'exercise.created',
  'exercise.updated',
  'exercise.archived',
  'plan.created',
  'plan.updated',
  'plan.activated',
  'plan.archived',
  'template.created',
  'template.updated',
  'template.deleted',
  'consent.granted',
  'consent.withdrawn',
  'measurement.recorded',
  'measurement.deleted',
  'progress_photo.added',
  'progress_photo.deleted',
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
