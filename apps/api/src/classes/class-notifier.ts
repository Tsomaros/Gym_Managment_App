import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { classBookings, classSessions, classTypes, gyms } from '../db/schema';
import { withGym } from '../db/tenant';
import { NotificationService } from '../notifications/notification.service';
import type { CancelledBooking } from './timetable.service';

/** A booked class that starts within this long gets its reminder. */
export const REMINDER_AHEAD_MS = 2 * 3600_000;

export interface ReminderRun {
  sent: number;
  skipped: number;
  failed: number;
}

/** Class reminders and cancellation notices, through the phase 5 NotificationService. */
@Injectable()
export class ClassNotifier {
  constructor(private readonly notifications: NotificationService) {}

  /** Every 15 minutes, all gyms: one reminder per booking, at most (dedupe class_reminder:<id>). */
  async remindersPassAll(now: Date): Promise<ReminderRun> {
    const total: ReminderRun = { sent: 0, skipped: 0, failed: 0 };
    const all = await systemDb.select({ id: gyms.id }).from(gyms);
    for (const { id } of all) {
      try {
        const r = await this.remindersPass(now, id);
        total.sent += r.sent;
        total.skipped += r.skipped;
        total.failed += r.failed;
      } catch (err) {
        console.error(`[classes] reminders, gym ${id}: ${(err as Error).message}`);
        total.failed++;
      }
    }
    return total;
  }

  /** With `gymId` one gym (tests); without it every gym. */
  async remindersPass(now: Date, gymId?: string): Promise<ReminderRun> {
    if (!gymId) return this.remindersPassAll(now);
    const due = await withGym(gymId, (tx) =>
      tx
        .select({
          bookingId: classBookings.id,
          memberId: classBookings.memberId,
          date: classSessions.date,
          startsAt: classSessions.startsAt,
          name: classTypes.name,
          nameEn: classTypes.nameEn,
        })
        .from(classBookings)
        .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
        .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
        .where(
          and(
            eq(classBookings.status, 'booked'),
            isNull(classSessions.cancelledAt),
            gt(classSessions.startsAtUtc, now),
            lte(classSessions.startsAtUtc, new Date(now.getTime() + REMINDER_AHEAD_MS)),
          ),
        ),
    );
    const run: ReminderRun = { sent: 0, skipped: 0, failed: 0 };
    for (const d of due) {
      try {
        const outcome = await this.notifications.notify({
          gymId,
          userId: d.memberId,
          event: 'class.reminder',
          dedupeKey: `class_reminder:${d.bookingId}`,
          params: {
            className: d.name,
            classNameEn: d.nameEn ?? '',
            date: d.date,
            startsAt: d.startsAt.slice(0, 5),
          },
        });
        if (outcome === 'sent') run.sent++;
        else if (outcome === 'failed') run.failed++;
        else run.skipped++;
      } catch (err) {
        console.error(`[classes] reminder for ${d.memberId}: ${(err as Error).message}`);
        run.failed++;
      }
    }
    return run;
  }

  /**
   * After the commit that cancelled the bookings: one notice per member (dedupe
   * class_cancelled:<sessionId>:<memberId>), sent in the background.
   */
  async notifyCancelled(gymId: string, cancelled: readonly CancelledBooking[]): Promise<void> {
    if (!cancelled.length) return;
    // Best effort: the cancel is committed already and must not turn into an error, because a
    // retry finds nothing left to cancel and could never send these notices.
    try {
      const sessions = await withGym(gymId, (tx) =>
        tx
          .select({
            id: classSessions.id,
            date: classSessions.date,
            startsAt: classSessions.startsAt,
            reason: classSessions.cancelReason,
            name: classTypes.name,
            nameEn: classTypes.nameEn,
          })
          .from(classSessions)
          .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
          .where(inArray(classSessions.id, [...new Set(cancelled.map((c) => c.sessionId))])),
      );
      const byId = new Map(sessions.map((s) => [s.id, s]));
      for (const c of cancelled) {
        const s = byId.get(c.sessionId);
        if (!s) continue;
        this.notifications.dispatch({
          gymId,
          userId: c.memberId,
          event: 'class.cancelled',
          dedupeKey: `class_cancelled:${c.sessionId}:${c.memberId}`,
          params: {
            className: s.name,
            classNameEn: s.nameEn ?? '',
            date: s.date,
            startsAt: s.startsAt.slice(0, 5),
            reason: s.reason ?? '',
          },
        });
      }
    } catch (err) {
      console.error(`[classes] cancel notices: ${(err as Error).message}`);
    }
  }
}
