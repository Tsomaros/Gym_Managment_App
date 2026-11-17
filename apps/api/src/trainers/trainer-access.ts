import type { Membership, MemberTrainer } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { memberTrainers, trainerCovers, users } from '../db/schema';
import type { Tx } from '../db/tenant';
import { membershipsOf } from '../memberships/memberships.service';

/** Some non-voided membership with personal training that is running, frozen or upcoming. */
export function hasTrainerMembership(ms: readonly Membership[]): boolean {
  return ms.some(
    (m) =>
      m.includesTrainer &&
      (m.status === 'active' || m.status === 'frozen' || m.status === 'upcoming'),
  );
}

/**
 * The member's primary trainer with the link's paused state, or null. `ms` are the member's
 * memberships already evaluated for today. Reads users through RLS: a trainer without a role in
 * the gym has no link left (removing the role deletes it).
 */
export async function primaryTrainerOf(
  tx: Tx,
  gymId: string,
  memberId: string,
  ms: readonly Membership[],
): Promise<MemberTrainer | null> {
  const [row] = await tx
    .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(memberTrainers)
    .innerJoin(users, eq(users.id, memberTrainers.trainerId))
    .where(and(eq(memberTrainers.gymId, gymId), eq(memberTrainers.memberId, memberId)));
  return row ? { ...row, paused: !hasTrainerMembership(ms) } : null;
}

/**
 * What a trainer may see of a member today (phase 4 reads plans through this):
 * 'primary' – an unpaused primary link (wins over a cover); 'cover' – a cover for `today`;
 * null – neither (a paused link counts as none).
 */
export async function trainerAccess(
  tx: Tx,
  gymId: string,
  trainerId: string,
  memberId: string,
  today: string,
): Promise<'primary' | 'cover' | null> {
  const [link] = await tx
    .select({ trainerId: memberTrainers.trainerId })
    .from(memberTrainers)
    .where(
      and(
        eq(memberTrainers.gymId, gymId),
        eq(memberTrainers.memberId, memberId),
        eq(memberTrainers.trainerId, trainerId),
      ),
    );
  if (link) {
    const ms = (await membershipsOf(tx, [memberId], today)).get(memberId) ?? [];
    if (hasTrainerMembership(ms)) return 'primary';
  }
  const [cover] = await tx
    .select({ id: trainerCovers.id })
    .from(trainerCovers)
    .where(
      and(
        eq(trainerCovers.gymId, gymId),
        eq(trainerCovers.memberId, memberId),
        eq(trainerCovers.trainerId, trainerId),
        eq(trainerCovers.date, today),
      ),
    );
  return cover ? 'cover' : null;
}

/**
 * Serialises changes around one trainer (assigning a member or a cover to them, removing their
 * role) until the transaction ends, so a link can't be created for a trainer whose role is being
 * removed at the same moment. Take it before reading the trainer's role.
 */
export async function lockTrainer(tx: Tx, trainerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'trainer:' + trainerId}))`);
}
