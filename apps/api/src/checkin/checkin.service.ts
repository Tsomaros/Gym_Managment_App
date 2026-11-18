import { Injectable, NotFoundException } from '@nestjs/common';
import type { CheckInMembership, CheckInReason, CheckInResult, Membership } from '@gym/shared';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import {
  checkIns,
  gymRoles,
  memberTrainers,
  memberships,
  trainerCovers,
  users,
} from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { ShiftsService } from '../shifts/shifts.service';
import { NotificationService } from '../notifications/notification.service';
import { PhotosService } from '../members/photos.service';
import { gymToday, lockMember, membershipsOf } from '../memberships/memberships.service';
import { CheckInEvents } from './checkin-events';
import { hasTrainerMembership } from '../trainers/trainer-access';
import { decideCheckIn, relevantMembership } from './decide';

/** A second check-in of the same member within this window repeats the first (spec §6.2). */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/** A visit pack with this many visits left (or fewer) tells the member. */
export const LOW_VISITS = 2;

export interface CheckInInput {
  gymId: string;
  memberId: string;
  method: 'kiosk' | 'manual';
  deviceId?: string;
  byUserId?: string;
}

type CheckInRow = typeof checkIns.$inferSelect;

/** What was paid is for the owner and reception; the live stream also reaches trainers. */
function withoutPrice(m: Membership): CheckInMembership {
  const rest: Partial<Membership> = { ...m };
  delete rest.priceCents;
  return rest as CheckInMembership;
}

@Injectable()
export class CheckInService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: CheckInEvents,
    private readonly notifications: NotificationService,
    private readonly photos: PhotosService,
    private readonly shifts: ShiftsService,
  ) {}

  /**
   * Records one check-in attempt, valid or not. Throws NotFoundException when `memberId` has no
   * member role in the gym. Under the member lock, so two devices scanning at once cannot spend
   * the same visit twice.
   */
  async checkIn(input: CheckInInput): Promise<CheckInResult> {
    const { gymId, memberId } = input;
    // Set when this check-in spent a visit and left 2 or fewer; announced after the commit.
    const lowRef: { value: { membershipId: string; membershipName: string; left: number } | null } =
      {
        value: null,
      };
    const result = await withGym(gymId, async (tx) => {
      await lockMember(tx, gymId, memberId);
      // Read after the lock, so concurrent attempts see each other's rows in order.
      const now = this.clock.now();

      const [member] = await tx
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
      if (!member) throw new NotFoundException('Not a member of this gym');

      const photoUrl = (await this.photos.urlsFor(tx, [memberId])).get(memberId) ?? null;
      const today = await gymToday(tx, gymId, now);
      const ms = (await membershipsOf(tx, [memberId], today)).get(memberId) ?? [];
      const trainers = await this.trainersOf(tx, gymId, memberId, today, ms);

      const [latest] = await tx
        .select()
        .from(checkIns)
        .where(eq(checkIns.memberId, memberId))
        .orderBy(desc(checkIns.at))
        .limit(1);
      if (
        latest &&
        !latest.checkedOutAt &&
        now.getTime() - latest.at.getTime() < DUPLICATE_WINDOW_MS
      ) {
        // A repeat of a valid check-in never spends a second visit. A refusal is repeated only
        // while it is still the verdict: a sale or an ended freeze in between must be honoured.
        const again = decideCheckIn(ms);
        if (latest.valid || (!again.valid && again.reason === latest.reason)) {
          return this.result(latest, member, photoUrl, ms, true, trainers);
        }
      }

      let decision = decideCheckIn(ms);
      let consumed = false;
      if (decision.valid && decision.consumeVisit) {
        // The WHERE is the last word on a race: zero rows means the pack was just used up.
        const updated = await tx
          .update(memberships)
          .set({ visitsUsed: sql`${memberships.visitsUsed} + 1` })
          .where(
            and(
              eq(memberships.id, decision.useMembershipId),
              lt(memberships.visitsUsed, memberships.visitsTotal),
              isNull(memberships.voidedAt),
            ),
          )
          .returning({ id: memberships.id });
        if (updated.length) consumed = true;
        else decision = { valid: false, reason: 'used_up' };
      }

      const [row] = await tx
        .insert(checkIns)
        .values({
          gymId,
          memberId,
          at: now,
          method: input.method,
          deviceId: input.deviceId ?? null,
          byUserId: input.byUserId ?? null,
          valid: decision.valid,
          reason: decision.valid ? null : decision.reason,
          membershipId: decision.valid ? decision.useMembershipId : null,
          visitConsumed: consumed,
        })
        .returning();

      if (input.method === 'manual') {
        await this.audit.record(tx, {
          gymId,
          actorId: input.byUserId ?? null,
          action: 'check_in.manual',
          entity: 'member',
          entityId: memberId,
          data: {
            checkInId: row!.id,
            valid: decision.valid,
            reason: decision.valid ? null : decision.reason,
          },
        });
      }

      // A pack that was just spent shows its new state on the card.
      const fresh = consumed
        ? ((await membershipsOf(tx, [memberId], today)).get(memberId) ?? ms)
        : ms;
      if (consumed && decision.valid) {
        const pack = fresh.find((m) => m.id === decision.useMembershipId);
        const left = pack?.remaining.visits;
        // Only a visit pack: a day pass has one use and a class pack has its own wording.
        if (pack?.kind === 'visits' && left !== null && left !== undefined && left <= LOW_VISITS) {
          lowRef.value = { membershipId: pack.id, membershipName: pack.name, left };
        }
      }
      return this.result(row!, member, photoUrl, fresh, false, trainers);
    });
    // After commit, and not for a repeat: the screens already show the first one.
    if (!result.duplicate) this.events.publish(gymId, { type: 'check_in', result });
    const low = lowRef.value;
    if (low) {
      // A failed email must never fail the check-in: dispatch runs in the background.
      this.notifications.dispatch({
        gymId,
        userId: memberId,
        event: 'visits.low',
        dedupeKey: `visits_low:${low.membershipId}:${low.left}`,
        params: { membershipName: low.membershipName, left: low.left },
      });
    }
    return result;
  }

  /** The member's primary trainer (and whether they are on duty now) and today's cover. */
  private async trainersOf(
    tx: Tx,
    gymId: string,
    memberId: string,
    today: string,
    ms: readonly Membership[],
  ): Promise<Pick<CheckInResult, 'trainer' | 'cover'>> {
    const [primary] = await tx
      .select({ userId: users.id, firstName: users.firstName })
      .from(memberTrainers)
      .innerJoin(users, eq(users.id, memberTrainers.trainerId))
      .where(eq(memberTrainers.memberId, memberId));
    const [cover] = await tx
      .select({ trainerId: users.id, firstName: users.firstName })
      .from(trainerCovers)
      .innerJoin(users, eq(users.id, trainerCovers.trainerId))
      .where(and(eq(trainerCovers.memberId, memberId), eq(trainerCovers.date, today)));
    // A paused link (no running membership with a trainer) gives the trainer no access: not shown.
    const linked = primary && hasTrainerMembership(ms) ? primary : undefined;
    const onDuty = await this.shifts.staffOnDutyNow(tx, gymId, linked ? [linked.userId] : []);
    return {
      trainer: linked ? { ...linked, onDuty: onDuty.has(linked.userId) } : null,
      cover: cover ?? null,
    };
  }

  /** The API shape of a stored check-in, with the membership that explains it. */
  private result(
    row: CheckInRow,
    member: { id: string; firstName: string; lastName: string },
    photoUrl: string | null,
    ms: readonly Membership[],
    duplicate: boolean,
    trainers: Pick<CheckInResult, 'trainer' | 'cover'>,
  ): CheckInResult {
    const reason = row.reason as CheckInReason | null;
    const membership =
      (row.membershipId ? ms.find((m) => m.id === row.membershipId) : undefined) ??
      (reason ? relevantMembership(ms, reason) : null) ??
      null;
    return {
      checkInId: row.id,
      valid: row.valid,
      reason,
      duplicate,
      method: row.method,
      member: {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        photoUrl,
      },
      membership: membership ? withoutPrice(membership) : null,
      at: row.at.toISOString(),
      ...trainers,
    };
  }
}
