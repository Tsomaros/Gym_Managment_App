import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CheckInReason, PresentMember, VisitorRow } from '@gym/shared';
import { and, desc, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { checkIns, gyms, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { memberStatus } from '../members/member-status';
import { PhotosService } from '../members/photos.service';
import { addDays, todayIn } from '../memberships/dates';
import { membershipsOf } from '../memberships/memberships.service';
import { CheckInEvents } from './checkin-events';

/** Start of a gym-local calendar day as an instant. */
const dayStart = (date: string, tz: string): SQL =>
  sql`(${date}::date)::timestamp at time zone ${tz}`;

async function gymClock(
  tx: Tx,
  gymId: string,
): Promise<{ timezone: string; autoCheckoutMinutes: number }> {
  const [g] = await tx
    .select({ timezone: gyms.timezone, autoCheckoutMinutes: gyms.autoCheckoutMinutes })
    .from(gyms)
    .where(eq(gyms.id, gymId));
  return g!;
}

@Injectable()
export class PresenceService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: CheckInEvents,
    private readonly photos: PhotosService,
  ) {}

  /**
   * Who is inside: a member's latest valid check-in today (gym time) that is not checked out and
   * is at most `auto_checkout_minutes` old (exactly that old still counts). Newest first.
   */
  async present(gymId: string): Promise<PresentMember[]> {
    return withGym(gymId, async (tx) => {
      const now = this.clock.now();
      const { timezone, autoCheckoutMinutes } = await gymClock(tx, gymId);
      const today = todayIn(timezone, now);
      const rows = await tx
        .select({
          id: checkIns.id,
          memberId: checkIns.memberId,
          at: checkIns.at,
          checkedOutAt: checkIns.checkedOutAt,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(checkIns)
        .innerJoin(users, eq(users.id, checkIns.memberId))
        .where(and(eq(checkIns.valid, true), gte(checkIns.at, dayStart(today, timezone))))
        .orderBy(desc(checkIns.at), desc(checkIns.id));

      const cutoff = now.getTime() - autoCheckoutMinutes * 60_000;
      const seen = new Set<string>();
      const inside: typeof rows = [];
      for (const r of rows) {
        if (seen.has(r.memberId)) continue; // only each member's latest valid check-in counts
        seen.add(r.memberId);
        if (!r.checkedOutAt && r.at.getTime() >= cutoff) inside.push(r);
      }

      const byMember = await membershipsOf(
        tx,
        inside.map((r) => r.memberId),
        today,
      );
      const photoUrls = await this.photos.urlsFor(
        tx,
        inside.map((r) => r.memberId),
      );
      return inside.map((r) => ({
        checkInId: r.id,
        memberId: r.memberId,
        firstName: r.firstName,
        lastName: r.lastName,
        photoUrl: photoUrls.get(r.memberId) ?? null,
        at: r.at.toISOString(),
        membershipStatus: memberStatus(byMember.get(r.memberId) ?? []).status,
      }));
    });
  }

  /** Every attempt of one gym-local day, refused ones included, newest first. */
  async visitors(gymId: string, date?: string): Promise<VisitorRow[]> {
    return withGym(gymId, async (tx) => {
      const { timezone } = await gymClock(tx, gymId);
      const day = date ?? todayIn(timezone, this.clock.now());
      const rows = await tx
        .select({
          id: checkIns.id,
          memberId: checkIns.memberId,
          at: checkIns.at,
          method: checkIns.method,
          valid: checkIns.valid,
          reason: checkIns.reason,
          checkedOutAt: checkIns.checkedOutAt,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(checkIns)
        .innerJoin(users, eq(users.id, checkIns.memberId))
        .where(
          and(
            gte(checkIns.at, dayStart(day, timezone)),
            lt(checkIns.at, dayStart(addDays(day, 1), timezone)),
          ),
        )
        .orderBy(desc(checkIns.at), desc(checkIns.id));
      return rows.map((r) => ({
        checkInId: r.id,
        memberId: r.memberId,
        firstName: r.firstName,
        lastName: r.lastName,
        at: r.at.toISOString(),
        method: r.method,
        valid: r.valid,
        reason: r.reason as CheckInReason | null,
        checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
      }));
    });
  }

  async checkOut(gymId: string, actorId: string, checkInId: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [row] = await tx
        .select({
          id: checkIns.id,
          memberId: checkIns.memberId,
          valid: checkIns.valid,
          checkedOutAt: checkIns.checkedOutAt,
        })
        .from(checkIns)
        .where(eq(checkIns.id, checkInId))
        .for('update');
      if (!row) throw new NotFoundException();
      if (!row.valid) throw new ConflictException('A refused check-in was never inside');
      if (row.checkedOutAt) throw new ConflictException('Already checked out');
      await tx
        .update(checkIns)
        .set({ checkedOutAt: this.clock.now(), checkedOutBy: actorId })
        .where(eq(checkIns.id, checkInId));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'check_in.checked_out',
        entity: 'check_in',
        entityId: checkInId,
        data: { memberId: row.memberId },
      });
    });
    this.events.publish(gymId, { type: 'check_out', checkInId });
  }
}
