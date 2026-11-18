import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { systemDb } from '../db/client';
import { classBookings, classSessions, gyms } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { BookingsService, consumeEntry } from './bookings.service';

const MIN_MS = 60_000;
/** A check-in marks a booking attended from this long before the class starts... */
export const CHECKIN_BEFORE_MS = 60 * MIN_MS;
/** ...until this long after it starts. */
export const CHECKIN_AFTER_MS = 15 * MIN_MS;
/** Bookings still `booked` this long after the class ends become no-shows. */
export const NO_SHOW_AFTER_MS = 30 * MIN_MS;

export interface NoShowRun {
  marked: number;
}

export interface WindowBooking {
  bookingId: string;
  membershipId: string | null;
  sessionId: string;
  typeId: string;
  startsAt: string;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly bookings: BookingsService,
  ) {}

  /**
   * Marks one booking, inside a transaction that already holds the member lock (check-in) or the
   * session row, the member lock and the booking row (`BookingsService.lockBooking`). Idempotent:
   * marking the same status again changes nothing, and the pack entry is consumed at most once
   * whatever the sequence of marks.
   */
  async markInTx(
    tx: Tx,
    b: typeof classBookings.$inferSelect,
    status: 'attended' | 'no_show',
    byUserId: string | null,
  ): Promise<boolean> {
    if (b.status === status) return false;
    if (b.status !== 'booked' && b.status !== 'attended' && b.status !== 'no_show') {
      throw new ConflictException('Not an active booking');
    }
    const now = this.clock.now();
    await tx
      .update(classBookings)
      .set({
        status,
        markedBy: byUserId,
        ...(status === 'attended' ? { attendedAt: now } : {}),
      })
      .where(eq(classBookings.id, b.id));
    await consumeEntry(tx, b);
    return true;
  }

  /** The trainer of the class, or reception, ticks a booking attended / no-show. */
  async mark(
    gymId: string,
    bookingId: string,
    status: 'attended' | 'no_show',
    byUserId: string,
    byRoles: readonly string[],
  ): Promise<void> {
    await withGym(gymId, async (tx) => {
      const { b, s } = await this.bookings.lockBooking(tx, bookingId);
      const staff = byRoles.includes('reception') || byRoles.includes('owner');
      if (!staff && s.trainerId !== byUserId) throw new ForbiddenException();
      if (s.cancelledAt !== null) throw new ConflictException('The class is cancelled');
      if (this.clock.now().getTime() < s.startsAtUtc.getTime() - CHECKIN_BEFORE_MS) {
        throw new BadRequestException('The class has not started');
      }
      const changed = await this.markInTx(tx, b, status, byUserId);
      if (changed) {
        await this.audit.record(tx, {
          gymId,
          actorId: byUserId,
          action: 'attendance.marked',
          entity: 'class_booking',
          entityId: bookingId,
          data: { status, memberId: b.memberId, sessionId: s.id },
        });
      }
    });
  }

  /** Bookings of finished classes that nobody marked become no-shows, once. All gyms. */
  async noShowPassAll(now: Date): Promise<NoShowRun & { failed: number }> {
    const all = await systemDb.select({ id: gyms.id }).from(gyms);
    const total = { marked: 0, failed: 0 };
    for (const { id } of all) {
      try {
        total.marked += (await this.noShowPass(id, now)).marked;
      } catch (err) {
        console.error(`[classes] no-show pass, gym ${id}: ${(err as Error).message}`);
        total.failed++;
      }
    }
    return total;
  }

  async noShowPass(gymId: string, now: Date): Promise<NoShowRun> {
    const cutoff = new Date(now.getTime() - NO_SHOW_AFTER_MS);
    const due = await withGym(gymId, (tx) =>
      tx
        .select({ id: classBookings.id })
        .from(classBookings)
        .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
        .where(
          and(
            eq(classBookings.status, 'booked'),
            isNull(classSessions.cancelledAt),
            lte(classSessions.endsAtUtc, cutoff),
          ),
        ),
    );
    let marked = 0;
    for (const { id } of due) {
      // One transaction per booking: a failure leaves the others, and the next pass retries it.
      const changed = await withGym(gymId, async (tx) => {
        const { b } = await this.bookings.lockBooking(tx, id);
        if (b.status !== 'booked') return false;
        return this.markInTx(tx, b, 'no_show', null);
      });
      if (changed) marked++;
    }
    return { marked };
  }

  /**
   * Still-`booked` bookings of this member whose check-in window is open now (60 min before the
   * start until 15 after), earliest class first. Reads only: the check-in holds the member lock.
   */
  async openWindowBookings(tx: Tx, memberId: string, now: Date): Promise<WindowBooking[]> {
    const from = new Date(now.getTime() - CHECKIN_AFTER_MS);
    const to = new Date(now.getTime() + CHECKIN_BEFORE_MS);
    const rows = await tx
      .select({
        bookingId: classBookings.id,
        membershipId: classBookings.membershipId,
        sessionId: classSessions.id,
        typeId: classSessions.classTypeId,
        startsAt: classSessions.startsAt,
        startsAtUtc: classSessions.startsAtUtc,
      })
      .from(classBookings)
      .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
      .where(
        and(
          eq(classBookings.memberId, memberId),
          eq(classBookings.status, 'booked'),
          isNull(classSessions.cancelledAt),
          lte(classSessions.startsAtUtc, to),
        ),
      )
      // Locked, so a session cancelled at the same moment is seen as cancelled (the rows are
      // re-checked once the lock is ours) and its booking never lets the member in.
      .for('update', { of: classBookings });
    return rows
      .filter((r) => r.startsAtUtc >= from)
      .sort((a, b) => a.startsAtUtc.getTime() - b.startsAtUtc.getTime())
      .map((r) => ({
        bookingId: r.bookingId,
        membershipId: r.membershipId,
        sessionId: r.sessionId,
        typeId: r.typeId,
        startsAt: r.startsAt.slice(0, 5),
      }));
  }
}
