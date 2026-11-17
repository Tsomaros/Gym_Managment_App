import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateFreeze, Freeze } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { membershipFreezes, memberships } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { addDays, daysBetweenInclusive, effectiveEnd, frozenDays } from './dates';
import { gymToday, lockMember, shiftFollowers } from './memberships.service';

type FreezeRow = typeof membershipFreezes.$inferSelect;

export function toFreeze(f: FreezeRow): Freeze {
  return {
    id: f.id,
    membershipId: f.membershipId,
    startsOn: f.startsOn,
    endsOn: f.endsOn,
    endedEarly: f.endedEarlyAt !== null,
    createdAt: f.createdAt.toISOString(),
  };
}

/** Recomputes the membership's effective end from its base end and its freezes; returns it. */
async function refreshEnd(
  tx: Tx,
  membershipId: string,
  baseEndsOn: string | null,
): Promise<string | null> {
  const freezes = await tx
    .select()
    .from(membershipFreezes)
    .where(eq(membershipFreezes.membershipId, membershipId));
  const endsOn = effectiveEnd(baseEndsOn, freezes);
  await tx.update(memberships).set({ endsOn }).where(eq(memberships.id, membershipId));
  return endsOn;
}

@Injectable()
export class FreezesService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Freezes a time-based membership that isn't voided or expired. The freeze starts today or
   * later, inside the membership's period, overlaps no other freeze of it, and keeps the total
   * within the type's maximum (409 with `remainingFreezeDays` otherwise).
   */
  create(
    gymId: string,
    actorId: string,
    membershipId: string,
    body: CreateFreeze,
  ): Promise<Freeze> {
    return withGym(gymId, async (tx) => {
      const m = await this.lockedMembership(tx, gymId, membershipId);
      const today = await gymToday(tx, gymId, this.clock.now());

      if (m.kind !== 'time') {
        throw new ConflictException({ message: 'Only time-based memberships can be frozen' });
      }
      if (m.voidedAt) throw new ConflictException({ message: 'The membership is voided' });
      if (m.endsOn! < today) throw new ConflictException({ message: 'The membership has expired' });
      if (body.startsOn < today) {
        throw new BadRequestException({ message: 'The freeze starts in the past' });
      }
      if (body.startsOn < m.startsOn || body.startsOn > m.endsOn!) {
        throw new BadRequestException({ message: 'The freeze must start within the membership' });
      }

      const existing = await tx
        .select()
        .from(membershipFreezes)
        .where(eq(membershipFreezes.membershipId, membershipId));
      if (existing.some((f) => f.startsOn <= body.endsOn && body.startsOn <= f.endsOn)) {
        throw new ConflictException({ message: 'Overlaps another freeze' });
      }
      const used = frozenDays(existing);
      const wanted = daysBetweenInclusive(body.startsOn, body.endsOn);
      if (used + wanted > m.maxFreezeDays) {
        throw new ConflictException({
          message: 'Not enough freeze days left',
          remainingFreezeDays: Math.max(0, m.maxFreezeDays - used),
        });
      }

      const [freeze] = await tx
        .insert(membershipFreezes)
        .values({ gymId, membershipId, ...body, createdBy: actorId })
        .returning();
      const newEnd = await refreshEnd(tx, membershipId, m.baseEndsOn);
      await shiftFollowers(tx, m.memberId, m.endsOn, newEnd, today);
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'freeze.created',
        entity: 'freeze',
        entityId: freeze!.id,
        data: { membershipId, memberId: m.memberId, startsOn: body.startsOn, endsOn: body.endsOn },
      });
      return toFreeze(freeze!);
    });
  }

  /**
   * Ends a freeze now. One that hasn't started, or started today, is removed; a running one is
   * cut to end yesterday. A freeze already over can't be ended (409).
   */
  end(gymId: string, actorId: string, freezeId: string): Promise<void> {
    return withGym(gymId, async (tx) => {
      const [found] = await tx
        .select({ membershipId: membershipFreezes.membershipId })
        .from(membershipFreezes)
        .where(eq(membershipFreezes.id, freezeId));
      if (!found) throw new NotFoundException();
      const m = await this.lockedMembership(tx, gymId, found.membershipId);
      const [freeze] = await tx
        .select()
        .from(membershipFreezes)
        .where(eq(membershipFreezes.id, freezeId));
      if (!freeze) throw new NotFoundException(); // removed while we waited for the lock

      const now = this.clock.now();
      const today = await gymToday(tx, gymId, now);
      let endsOn: string | null;
      if (freeze.startsOn >= today) {
        await tx.delete(membershipFreezes).where(eq(membershipFreezes.id, freezeId));
        endsOn = null;
      } else if (freeze.endsOn >= today) {
        endsOn = addDays(today, -1);
        await tx
          .update(membershipFreezes)
          .set({ endsOn, endedEarlyAt: now })
          .where(eq(membershipFreezes.id, freezeId));
      } else {
        throw new ConflictException({ message: 'The freeze is already over' });
      }
      const newEnd = await refreshEnd(tx, m.id, m.baseEndsOn);
      await shiftFollowers(tx, m.memberId, m.endsOn, newEnd, today);
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'freeze.ended',
        entity: 'freeze',
        entityId: freezeId,
        data: { membershipId: m.id, memberId: m.memberId, removed: endsOn === null, endsOn },
      });
    });
  }

  /** The membership, after taking the member's lock (shared with selling and voiding). */
  private async lockedMembership(tx: Tx, gymId: string, membershipId: string) {
    const [owner] = await tx
      .select({ memberId: memberships.memberId })
      .from(memberships)
      .where(eq(memberships.id, membershipId));
    if (!owner) throw new NotFoundException();
    await lockMember(tx, gymId, owner.memberId);
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
    return m!;
  }
}
