import { Injectable } from '@nestjs/common';
import { and, between, eq, isNull } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { gyms, memberships } from '../db/schema';
import { withGym } from '../db/tenant';
import { addDays, hourIn, todayIn } from '../memberships/dates';
import { membershipsOf } from '../memberships/memberships.service';
import { NotificationService } from './notification.service';
import { selectReminders } from './select-reminders';

/** Scheduled reminders go out from this local hour of the gym on (plan: 10:00). */
export const SEND_HOUR = 10;

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
      return {
        today,
        reminderDays: gym.reminderDays,
        memberships: [...byMember.values()].flat(),
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
