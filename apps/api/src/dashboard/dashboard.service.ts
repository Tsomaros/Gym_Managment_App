import { Injectable } from '@nestjs/common';
import type { Dashboard } from '@gym/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { PresenceService } from '../checkin/presence.service';
import { checkIns, gyms, memberships, payments } from '../db/schema';
import { withGym } from '../db/tenant';
import { memberStatus } from '../members/member-status';
import { todayIn } from '../memberships/dates';
import { membershipsOf } from '../memberships/memberships.service';
import { busyHours, incomeByMonth, lastMonths, memberFlow } from './dashboard-math';

const MONTHS = 12;
const BUSY_HOURS_WEEKS = 8;
const ID_BATCH = 1000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly clock: Clock,
    private readonly presence: PresenceService,
  ) {}

  /**
   * Everything the owner's dashboard shows, read in one transaction (each statement sees the latest
   * committed data, which is fine for a dashboard) and
   * computed by the pure functions in dashboard-math. A gym has hundreds to a few thousand
   * payments and memberships a year, so the rows are read and summed here instead of in SQL.
   */
  async get(gymId: string): Promise<Dashboard> {
    const now = this.clock.now();
    const base = await withGym(gymId, async (tx) => {
      const [gym] = await tx
        .select({ timezone: gyms.timezone })
        .from(gyms)
        .where(eq(gyms.id, gymId));
      const tz = gym!.timezone;
      const today = todayIn(tz, now);
      const months = lastMonths(today, MONTHS);

      const paid = await tx
        .select({
          paidAt: payments.paidAt,
          amountCents: payments.amountCents,
          method: payments.method,
          typeName: memberships.name,
          voidedAt: payments.voidedAt,
        })
        .from(payments)
        .innerJoin(memberships, eq(memberships.id, payments.membershipId))
        .where(
          gte(payments.paidAt, sql`(${`${months[0]}-01`}::date)::timestamp at time zone ${tz}`),
        );

      const owned = await tx
        .select({
          id: memberships.id,
          memberId: memberships.memberId,
          kind: memberships.kind,
          startsOn: memberships.startsOn,
          endsOn: memberships.endsOn,
          voidedAt: memberships.voidedAt,
          visitsTotal: memberships.visitsTotal,
          visitsUsed: memberships.visitsUsed,
        })
        .from(memberships);

      const since = new Date(now.getTime() - BUSY_HOURS_WEEKS * 7 * 86_400_000);
      const visits = await tx
        .select({ at: checkIns.at, valid: checkIns.valid })
        .from(checkIns)
        .where(and(gte(checkIns.at, since), eq(checkIns.valid, true)));

      const memberIds = [...new Set(owned.filter((m) => !m.voidedAt).map((m) => m.memberId))];
      // In batches: one bind parameter per id, and Postgres allows 65,535 per statement.
      let expiringSoon = 0;
      for (let i = 0; i < memberIds.length; i += ID_BATCH) {
        const ids = memberIds.slice(i, i + ID_BATCH);
        const byMember = await membershipsOf(tx, ids, today);
        expiringSoon += ids.filter(
          (id) => memberStatus(byMember.get(id) ?? []).status === 'expiring',
        ).length;
      }

      return { tz, today, months, paid, owned, visits, expiringSoon };
    });

    const { tz, today, months } = base;
    const [visitors, present] = await Promise.all([
      this.presence.visitors(gymId),
      this.presence.present(gymId),
    ]);

    return {
      income: incomeByMonth(
        base.paid.map((p) => ({
          paidAt: p.paidAt,
          amountCents: p.amountCents,
          method: p.method,
          typeName: p.typeName,
          voided: p.voidedAt !== null,
        })),
        months,
        tz,
      ),
      members: memberFlow(
        base.owned.map((m) => ({
          id: m.id,
          memberId: m.memberId,
          kind: m.kind,
          startsOn: m.startsOn,
          effectiveEndsOn: m.endsOn,
          voided: m.voidedAt !== null,
          exhausted: m.visitsTotal !== null && m.visitsUsed >= m.visitsTotal,
        })),
        months,
        today,
      ),
      busyHours: busyHours(base.visits, tz),
      today: {
        visitors: new Set(visitors.filter((v) => v.valid).map((v) => v.memberId)).size,
        present: present.length,
        expiringSoon: base.expiringSoon,
      },
    };
  }
}
