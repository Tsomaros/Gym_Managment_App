import { Injectable } from '@nestjs/common';
import { and, between, eq, gte, inArray, isNull } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { checkIns, gyms, memberships, plans } from '../db/schema';
import { withGym } from '../db/tenant';
import { addDays, hourIn, todayIn } from '../memberships/dates';
import { membershipsOf } from '../memberships/memberships.service';
import { LOW_VISITS } from '../checkin/checkin.service';
import { NotificationService } from './notification.service';
import { selectReminders } from './select-reminders';

/** Scheduled reminders go out from this local hour of the gym on (plan: 10:00). */
export const SEND_HOUR = 10;

/** Events older than this are not retried: a day-old "new plan" email would only confuse. */
const RETRY_WINDOW_MS = 24 * 3600_000;

export interface ReminderRun {
  sent: number;
  duplicate: number;
  optedOut: number;
  failed: number;
}

@Injectable()
export class RemindersService {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * Sends the due "expiring" and "expires today" reminders of one gym. Does nothing before 10:00
   * gym time. Safe to run any number of times a day, also after downtime: the dedupe keys make a
   * repeat a no-op, and a failed send is simply tried again.
   */
  async runForGym(gymId: string, now: Date): Promise<ReminderRun> {
    const result: ReminderRun = { sent: 0, duplicate: 0, optedOut: 0, failed: 0 };
    const plan = await withGym(gymId, async (tx) => {
      const [gym] = await tx
        .select({ timezone: gyms.timezone, reminderDays: gyms.reminderDays })
        .from(gyms)
        .where(eq(gyms.id, gymId));
      if (!gym || hourIn(gym.timezone, now) < SEND_HOUR) return null;
      const today = todayIn(gym.timezone, now);
      const candidates = await tx
        .selectDistinct({ memberId: memberships.memberId })
        .from(memberships)
        .where(
          and(
            isNull(memberships.voidedAt),
            between(memberships.endsOn, today, addDays(today, gym.reminderDays)),
          ),
        );
      const byMember = await membershipsOf(
        tx,
        candidates.map((c) => c.memberId),
        today,
      );

      // Events that fire when something happens (a visit used, a plan activated) are sent then; if
      // that failed, this run sends them again. The dedupe keys are the same, so a delivered one
      // is never repeated. Only the last day is looked at: older ones are not worth a late email.
      const since = new Date(now.getTime() - RETRY_WINDOW_MS);
      const spent = await tx
        .selectDistinct({ membershipId: checkIns.membershipId })
        .from(checkIns)
        .where(and(eq(checkIns.visitConsumed, true), gte(checkIns.at, since)));
      const spentIds = spent.map((r) => r.membershipId).filter((id): id is string => id !== null);
      const packOwners = spentIds.length
        ? await tx
            .select({ memberId: memberships.memberId })
            .from(memberships)
            .where(and(inArray(memberships.id, spentIds), eq(memberships.kind, 'visits')))
        : [];
      const packsByMember = await membershipsOf(
        tx,
        [...new Set(packOwners.map((r) => r.memberId))],
        today,
      );
      const lowPacks = [...packsByMember.values()]
        .flat()
        .filter(
          (m) =>
            spentIds.includes(m.id) &&
            m.kind === 'visits' &&
            m.remaining.visits !== null &&
            m.remaining.visits <= LOW_VISITS,
        );
      const newPlans = await tx
        .select({
          id: plans.id,
          memberId: plans.memberId,
          title: plans.title,
          activatedAt: plans.activatedAt,
        })
        .from(plans)
        .where(
          and(
            eq(plans.status, 'active'),
            eq(plans.isTemplate, false),
            gte(plans.activatedAt, since),
          ),
        );
      return {
        today,
        reminderDays: gym.reminderDays,
        memberships: [...byMember.values()].flat(),
        lowPacks,
        newPlans,
      };
    });
    if (!plan) return result;

    for (const due of selectReminders(plan)) {
      const key = due.event === 'membership.expiring' ? 'expiring' : 'expires_today';
      let outcome: 'sent' | 'duplicate' | 'opted_out' | 'failed';
      try {
        outcome = await this.notifications.notify({
          gymId,
          userId: due.memberId,
          event: due.event,
          dedupeKey: `${key}:${due.membershipId}:${due.endsOn}`,
          params: { membershipName: due.membershipName, endsOn: due.endsOn, days: due.days },
        });
      } catch (err) {
        console.error(`[reminders] ${due.event} for ${due.memberId}: ${(err as Error).message}`);
        outcome = 'failed';
      }
      if (outcome === 'opted_out') result.optedOut++;
      else result[outcome]++;
    }

    const tally = (outcome: 'sent' | 'duplicate' | 'opted_out' | 'failed') => {
      if (outcome === 'opted_out') result.optedOut++;
      else result[outcome]++;
    };
    const attempt = async (input: Parameters<NotificationService['notify']>[0]) => {
      try {
        tally(await this.notifications.notify(input));
      } catch (err) {
        console.error(`[reminders] ${input.event} for ${input.userId}: ${(err as Error).message}`);
        result.failed++;
      }
    };
    for (const pack of plan.lowPacks) {
      await attempt({
        gymId,
        userId: pack.memberId,
        event: 'visits.low',
        dedupeKey: `visits_low:${pack.id}:${pack.remaining.visits}`,
        params: { membershipName: pack.name, left: pack.remaining.visits! },
      });
    }
    for (const p of plan.newPlans) {
      if (!p.memberId || !p.activatedAt) continue;
      await attempt({
        gymId,
        userId: p.memberId,
        event: 'plan.assigned',
        dedupeKey: `plan:${p.id}:${p.activatedAt.getTime()}`,
        params: { planName: p.title },
      });
    }
    return result;
  }

  /** Every gym in turn; one gym failing never stops the others. */
  async runAll(now: Date): Promise<ReminderRun & { gyms: number }> {
    const total = { gyms: 0, sent: 0, duplicate: 0, optedOut: 0, failed: 0 };
    const all = await systemDb.select({ id: gyms.id }).from(gyms);
    for (const { id } of all) {
      try {
        const r = await this.runForGym(id, now);
        total.sent += r.sent;
        total.duplicate += r.duplicate;
        total.optedOut += r.optedOut;
        total.failed += r.failed;
      } catch (err) {
        console.error(`[reminders] gym ${id}: ${(err as Error).message}`);
        total.failed++;
      }
      total.gyms++;
    }
    return total;
  }
}
