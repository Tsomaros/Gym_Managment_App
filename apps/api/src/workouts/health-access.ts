import type { GymRole } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { gymRoles } from '../db/schema';
import type { Tx } from '../db/tenant';
import { trainerAccess } from '../trainers/trainer-access';

export interface HealthAccess {
  read: boolean;
  writeMeasurements: boolean;
  writePhotos: boolean;
  writeSessions: boolean;
}

export const NO_ACCESS: HealthAccess = {
  read: false,
  writeMeasurements: false,
  writePhotos: false,
  writeSessions: false,
};

/**
 * What the caller may do with a member's workout log, progress, measurements and photos (spec §5,
 * §6.4, §6.7): the member reads and logs their own, adds photos and never records measurements;
 * the primary trainer reads and records measurements and photos but never logs sessions; a cover
 * trainer only reads, for the day of the cover; everyone else, the owner and reception included,
 * gets nothing. A `memberId` without a member role in the gym gets nothing too, so a 404 never
 * tells whether a person exists.
 */
export async function healthAccess(
  tx: Tx,
  gymId: string,
  caller: { userId: string; roles: GymRole[] },
  memberId: string,
  today: string,
): Promise<HealthAccess> {
  const [isMember] = await tx
    .select({ userId: gymRoles.userId })
    .from(gymRoles)
    .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
  if (!isMember) return NO_ACCESS;
  if (caller.userId === memberId && caller.roles.includes('member')) {
    return { read: true, writeMeasurements: false, writePhotos: true, writeSessions: true };
  }
  if (!caller.roles.includes('trainer')) return NO_ACCESS;
  const access = await trainerAccess(tx, gymId, caller.userId, memberId, today);
  if (access === 'primary') {
    return { read: true, writeMeasurements: true, writePhotos: true, writeSessions: false };
  }
  return access === 'cover' ? { ...NO_ACCESS, read: true } : NO_ACCESS;
}
