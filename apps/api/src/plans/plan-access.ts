import type { GymRole } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { gymRoles } from '../db/schema';
import type { Tx } from '../db/tenant';
import { trainerAccess } from '../trainers/trainer-access';

export type PlanAccess = 'write' | 'read' | null;

/**
 * What the caller may do with a member's plans (spec §5, §6.4):
 * - the member themself reads (active plan and history), never writes;
 * - a trainer with an unpaused primary link reads and writes;
 * - a trainer covering the member for `today` only reads;
 * - everyone else, including the owner and reception, gets null (health-adjacent data).
 * A `memberId` that holds no member role in this gym gets null too, so a 404 never tells whether
 * a plan or even a person exists.
 */
export async function planAccess(
  tx: Tx,
  gymId: string,
  caller: { userId: string; roles: GymRole[] },
  memberId: string,
  today: string,
): Promise<PlanAccess> {
  const [isMember] = await tx
    .select({ userId: gymRoles.userId })
    .from(gymRoles)
    .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
  if (!isMember) return null;
  if (caller.userId === memberId && caller.roles.includes('member')) return 'read';
  if (!caller.roles.includes('trainer')) return null;
  const access = await trainerAccess(tx, gymId, caller.userId, memberId, today);
  return access === 'primary' ? 'write' : access === 'cover' ? 'read' : null;
}
