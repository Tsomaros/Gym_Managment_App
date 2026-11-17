import { z } from 'zod';

/** Roles that make someone staff; `member` is not managed through the staff routes. */
export const STAFF_ROLES = ['owner', 'reception', 'trainer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const StaffRoleSchema = z.enum(STAFF_ROLES);

export interface StaffMember {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  roles: StaffRole[];
  /** When the person got their earliest staff role in this gym (ISO). */
  since: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: ('owner' | 'reception' | 'trainer' | 'member')[];
  expiresAt: string;
}

export interface StaffList {
  staff: StaffMember[];
  /** Always empty for reception: only the owner sees pending staff invitations. */
  pending: PendingInvitation[];
}
