import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership, SellMembership } from '@gym/shared';
import { and, eq, gt, gte, isNull, max, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import {
  gymRoles,
  gyms,
  membershipFreezes,
  memberships,
  membershipTypes,
  payments,
} from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { addDays, type DateRange, daysBetweenInclusive, periodEnd, todayIn } from './dates';
import { membershipStatus, remaining } from './status';

type MembershipRow = typeof memberships.$inferSelect;

/** The API shape of a membership row, with its status and what's left on `today`. */
export function toMembership(
  r: MembershipRow,
  freezes: readonly DateRange[],
  today: string,
): Membership {
  const m = {
    kind: r.kind,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    visitsTotal: r.visitsTotal,
    visitsUsed: r.visitsUsed,
    voidedAt: r.voidedAt,
  };
  return {
    id: r.id,
    memberId: r.memberId,
    typeId: r.typeId,
    name: r.name,
    kind: r.kind,
    includesTrainer: r.includesTrainer,
    includesClasses: r.includesClasses,
    maxFreezeDays: r.maxFreezeDays,
    priceCents: r.priceCents,
    startsOn: r.startsOn,
    endsOn: r.baseEndsOn,
    effectiveEndsOn: r.endsOn,
    visitsTotal: r.visitsTotal,
    visitsUsed: r.visitsUsed,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    status: membershipStatus(m, freezes, today),
    remaining: remaining(m, freezes, today),
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Serialises everything that changes a member's memberships (sell, void, freeze) within one
 * transaction, so a sale never reads an end date that a concurrent freeze or void is changing.
 */
export async function lockMember(tx: Tx, gymId: string, memberId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${gymId}:${memberId}`}, 0))`,
  );
}

/**
 * When a time membership's end moves from `oldEnd` to `newEnd` (a freeze, an early end, a void),
 * the not-yet-started time memberships booked to start "the day after" follow it, one after the
 * other, so a renewal never overlaps or leaves a gap. Each keeps its paid length in days, and
 * any freeze booked on it moves with it. Call under lockMember.
 */
export async function shiftFollowers(
  tx: Tx,
  memberId: string,
  oldEnd: string | null,
  newEnd: string | null,
  today: string,
): Promise<void> {
  let prevOld = oldEnd;
  let prevNew = newEnd;
  // A member has a handful of queued renewals at most; the bound only guards against a loop.
  for (let step = 0; step < 50 && prevOld && prevNew && prevOld !== prevNew; step++) {
    const [next] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.memberId, memberId),
          eq(memberships.kind, 'time'),
          isNull(memberships.voidedAt),
          eq(memberships.startsOn, addDays(prevOld, 1)),
          gt(memberships.startsOn, today),
        ),
      )
      .limit(1);
    if (!next) return;
    let newStart = addDays(prevNew, 1);
    if (newStart < today) newStart = today;
    const delta = daysBetweenInclusive(next.startsOn, newStart) - 1;
    if (delta === 0) return;
    const newEndsOn = addDays(next.endsOn!, delta);
    await tx
      .update(memberships)
      .set({ startsOn: newStart, baseEndsOn: addDays(next.baseEndsOn!, delta), endsOn: newEndsOn })
      .where(eq(memberships.id, next.id));
    const booked = await tx
      .select()
      .from(membershipFreezes)
      .where(eq(membershipFreezes.membershipId, next.id));
    for (const f of booked) {
      await tx
        .update(membershipFreezes)
        .set({ startsOn: addDays(f.startsOn, delta), endsOn: addDays(f.endsOn, delta) })
        .where(eq(membershipFreezes.id, f.id));
    }
    prevOld = next.endsOn;
    prevNew = newEndsOn;
  }
}

/** Today in the gym's time zone, inside a gym transaction. */
export async function gymToday(tx: Tx, gymId: string, now: Date): Promise<string> {
  const [gym] = await tx.select({ timezone: gyms.timezone }).from(gyms).where(eq(gyms.id, gymId));
  return todayIn(gym!.timezone, now);
}

@Injectable()
export class MembershipsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Sells a type to a member and records the payment, in one transaction. A time-based
   * membership bought early starts the day after the member's current one ends (frozen days
   * included); everything else starts today, unless a later start is chosen.
   */
  sell(
    gymId: string,
    actorId: string,
    memberId: string,
    body: SellMembership,
  ): Promise<Membership> {
    return withGym(gymId, async (tx) => {
      await lockMember(tx, gymId, memberId);

      const [isMember] = await tx
        .select({ userId: gymRoles.userId })
        .from(gymRoles)
        .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
      if (!isMember) throw new NotFoundException({ message: 'Not a member of this gym' });

      const [type] = await tx
        .select()
        .from(membershipTypes)
        .where(eq(membershipTypes.id, body.typeId));
      if (!type) throw new NotFoundException({ message: 'Unknown membership type' });
      if (type.archivedAt) throw new ConflictException({ message: 'This type is archived' });
      // A discount is fine; charging more than the price is a typo.
      if (body.amountCents > type.priceCents) {
        throw new BadRequestException({ message: 'The amount is above the price' });
      }

      const now = this.clock.now();
      const today = await gymToday(tx, gymId, now);
      let startsOn: string;
      if (body.startsOn) {
        if (body.startsOn < today) {
          throw new BadRequestException({ message: 'The start date is in the past' });
        }
        if (body.startsOn > addDays(today, 366)) {
          throw new BadRequestException({ message: 'The start date is more than a year ahead' });
        }
        startsOn = body.startsOn;
      } else if (type.kind === 'time') {
        const [current] = await tx
          .select({ lastEnd: max(memberships.endsOn) })
          .from(memberships)
          .where(
            and(
              eq(memberships.memberId, memberId),
              eq(memberships.kind, 'time'),
              isNull(memberships.voidedAt),
              gte(memberships.endsOn, today),
            ),
          );
        startsOn = current?.lastEnd ? addDays(current.lastEnd, 1) : today;
      } else {
        startsOn = today;
      }

      let baseEndsOn: string | null;
      let visitsTotal: number | null = null;
      if (type.kind === 'time') {
        baseEndsOn = periodEnd(startsOn, type.durationMonths!);
      } else if (type.kind === 'day_pass') {
        baseEndsOn = startsOn;
        visitsTotal = 1;
      } else {
        visitsTotal = type.visitCount;
        baseEndsOn = type.validityDays ? addDays(startsOn, type.validityDays - 1) : null;
      }

      const [row] = await tx
        .insert(memberships)
        .values({
          gymId,
          memberId,
          typeId: type.id,
          name: type.name,
          kind: type.kind,
          includesTrainer: type.includesTrainer,
          includesClasses: type.includesClasses,
          maxFreezeDays: type.maxFreezeDays,
          priceCents: type.priceCents,
          startsOn,
          baseEndsOn,
          endsOn: baseEndsOn,
          visitsTotal,
          createdBy: actorId,
        })
        .returning();
      await tx.insert(payments).values({
        gymId,
        membershipId: row!.id,
        memberId,
        amountCents: body.amountCents,
        method: body.method,
        // The same clock that decided "today", so the payment lands on the day it was sold.
        paidAt: now,
        recordedBy: actorId,
      });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'membership.sold',
        entity: 'membership',
        entityId: row!.id,
        data: {
          memberId,
          typeName: type.name,
          amountCents: body.amountCents,
          method: body.method,
          startsOn,
          endsOn: baseEndsOn,
        },
      });
      return toMembership(row!, [], today);
    });
  }
}
