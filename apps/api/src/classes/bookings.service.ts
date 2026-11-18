import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Attendee, BookingStatus, BookingView, Membership } from '@gym/shared';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import {
  classBookings,
  classSessions,
  classTypes,
  gymRoles,
  gyms,
  membershipFreezes,
  memberships,
  users,
} from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { PhotosService } from '../members/photos.service';
import { lockMember } from '../memberships/memberships.service';
import { toMembership } from '../memberships/memberships.service';
import { classEligibility } from './class-eligibility';

const hhmm = (t: string): string => t.slice(0, 5);
const DAY_MS = 86_400_000;
/** A member can book from this long before the class starts. */
export const BOOKING_WINDOW_MS = 14 * DAY_MS;

type BookingRow = typeof classBookings.$inferSelect;

/** Postgres error code of a failed query (Drizzle wraps the driver error in `cause`). */
const pgCode = (err: unknown): string | undefined =>
  (err as { cause?: { code?: string }; code?: string }).cause?.code ??
  (err as { code?: string }).code;

/**
 * Consumes one entry of the class pack behind a booking, once: no-op when the booking is already
 * consumed or isn't paid by a pack. Call inside a transaction that holds the member lock.
 */
export async function consumeEntry(tx: Tx, booking: BookingRow): Promise<boolean> {
  if (booking.entryConsumed || !booking.membershipId) return false;
  const updated = await tx
    .update(memberships)
    .set({ visitsUsed: sql`${memberships.visitsUsed} + 1` })
    .where(
      and(
        eq(memberships.id, booking.membershipId),
        eq(memberships.kind, 'classes'),
        sql`${memberships.visitsUsed} < ${memberships.visitsTotal}`,
      ),
    )
    .returning({ id: memberships.id });
  if (!updated.length) return false;
  await tx
    .update(classBookings)
    .set({ entryConsumed: true })
    .where(eq(classBookings.id, booking.id));
  return true;
}

/** Bookings still `booked` that hold one entry of each of these class packs. */
export async function reservedByPack(
  tx: Tx,
  membershipIds: readonly string[],
): Promise<Record<string, number>> {
  if (!membershipIds.length) return {};
  const rows = await tx
    .select({ id: classBookings.membershipId, n: sql<number>`count(*)::int` })
    .from(classBookings)
    .where(
      and(inArray(classBookings.membershipId, [...membershipIds]), eq(classBookings.status, 'booked')),
    )
    .groupBy(classBookings.membershipId);
  return Object.fromEntries(rows.map((r) => [r.id!, r.n]));
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly photos: PhotosService,
  ) {}

  /** The member's memberships as they stand on `date`, plus how many entries each pack has reserved. */
  private async membershipsOn(
    tx: Tx,
    memberId: string,
    date: string,
  ): Promise<{ ms: Membership[]; reserved: Record<string, number> }> {
    const rows = await tx.select().from(memberships).where(eq(memberships.memberId, memberId));
    if (!rows.length) return { ms: [], reserved: {} };
    const freezes = await tx
      .select()
      .from(membershipFreezes)
      .where(
        inArray(
          membershipFreezes.membershipId,
          rows.map((r) => r.id),
        ),
      );
    const ms = rows.map((r) =>
      toMembership(
        r,
        freezes.filter((x) => x.membershipId === r.id),
        date,
      ),
    );
    const reserved = await reservedByPack(
      tx,
      rows.filter((r) => r.kind === 'classes').map((r) => r.id),
    );
    return { ms, reserved };
  }

  /** Books `memberId` into the session. Locks: session row, then the member, then memberships. */
  async book(
    gymId: string,
    actorId: string,
    sessionId: string,
    memberId: string,
  ): Promise<{ id: string; status: BookingStatus; usesEntry: boolean }> {
    try {
      return await withGym(gymId, async (tx) => {
        const now = this.clock.now();
        const [s] = await tx
          .select()
          .from(classSessions)
          .where(eq(classSessions.id, sessionId))
          .for('update');
        if (!s) throw new NotFoundException();
        if (s.cancelledAt !== null) throw new GoneException('The class is cancelled');
        if (s.startsAtUtc <= now) throw new BadRequestException('The class has started');
        if (now.getTime() < s.startsAtUtc.getTime() - BOOKING_WINDOW_MS) {
          throw new BadRequestException('Booking opens 14 days before the class');
        }
        await lockMember(tx, gymId, memberId);
        const [isMember] = await tx
          .select({ userId: gymRoles.userId })
          .from(gymRoles)
          .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
        if (!isMember) throw new NotFoundException('No such member');

        const live = await tx
          .select({ memberId: classBookings.memberId })
          .from(classBookings)
          .where(
            and(
              eq(classBookings.sessionId, sessionId),
              inArray(classBookings.status, ['booked', 'attended']),
            ),
          );
        if (live.some((b) => b.memberId === memberId)) throw new ConflictException('Already booked');

        const { ms, reserved } = await this.membershipsOn(tx, memberId, s.date);
        const eligible = classEligibility(ms, reserved);
        if (!eligible.ok) throw new ConflictException('No membership for classes');
        if (live.length >= s.capacity) throw new ConflictException('Class full');

        const [row] = await tx
          .insert(classBookings)
          .values({
            gymId,
            sessionId,
            memberId,
            membershipId: eligible.membershipId,
            bookedBy: actorId,
          })
          .returning({ id: classBookings.id, status: classBookings.status });
        return { id: row!.id, status: row!.status, usesEntry: eligible.usesEntry };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictException('Already booked');
      throw err;
    }
  }

  /** The booking's session row, locked, then the booking itself (same order everywhere). */
  private async lockBooking(
    tx: Tx,
    bookingId: string,
    only?: { memberId: string },
  ): Promise<{ b: BookingRow; s: typeof classSessions.$inferSelect }> {
    const [first] = await tx
      .select()
      .from(classBookings)
      .where(
        and(
          eq(classBookings.id, bookingId),
          only ? eq(classBookings.memberId, only.memberId) : undefined,
        ),
      );
    if (!first) throw new NotFoundException();
    const [s] = await tx
      .select()
      .from(classSessions)
      .where(eq(classSessions.id, first.sessionId))
      .for('update');
    await lockMember(tx, first.gymId, first.memberId);
    const [b] = await tx
      .select()
      .from(classBookings)
      .where(eq(classBookings.id, bookingId))
      .for('update');
    return { b: b!, s: s! };
  }

  /** The member cancels their own booking: free before the cut-off, a late cancel after it. */
  async cancelOwn(
    gymId: string,
    memberId: string,
    bookingId: string,
  ): Promise<{ status: 'cancelled' | 'late_cancelled' }> {
    return withGym(gymId, async (tx) => {
      const now = this.clock.now();
      const { b, s } = await this.lockBooking(tx, bookingId, { memberId });
      if (b.status !== 'booked') throw new ConflictException('Not an active booking');
      if (s.startsAtUtc <= now) throw new BadRequestException('The class has started');
      const [g] = await tx
        .select({ cutoff: gyms.classCancelCutoffMinutes })
        .from(gyms)
        .where(eq(gyms.id, gymId));
      const late = s.startsAtUtc.getTime() - now.getTime() <= g!.cutoff * 60_000;
      const status = late ? 'late_cancelled' : 'cancelled';
      await tx
        .update(classBookings)
        .set({ status, cancelledAt: now })
        .where(eq(classBookings.id, bookingId));
      if (late) await consumeEntry(tx, b);
      return { status };
    });
  }

  /** Staff cancel for a member at any time before the class is marked: never charged. */
  async cancelByStaff(gymId: string, actorId: string, bookingId: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const { b, s } = await this.lockBooking(tx, bookingId);
      if (b.status !== 'booked') throw new ConflictException('Not an active booking');
      await tx
        .update(classBookings)
        .set({ status: 'cancelled', cancelledAt: this.clock.now() })
        .where(eq(classBookings.id, bookingId));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'booking.cancelled_by_staff',
        entity: 'class_booking',
        entityId: bookingId,
        data: { memberId: b.memberId, sessionId: s.id, date: s.date },
      });
    });
  }

  /** Who is booked into a session: the class's trainer, or reception/owner. */
  async attendees(
    gymId: string,
    actorId: string,
    actorRoles: readonly string[],
    sessionId: string,
  ): Promise<Attendee[]> {
    return withGym(gymId, async (tx) => {
      const [s] = await tx.select().from(classSessions).where(eq(classSessions.id, sessionId));
      if (!s) throw new NotFoundException();
      const staff = actorRoles.includes('reception') || actorRoles.includes('owner');
      if (!staff && s.trainerId !== actorId) throw new ForbiddenException();
      const rows = await tx
        .select({
          bookingId: classBookings.id,
          status: classBookings.status,
          memberId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(classBookings)
        .innerJoin(users, eq(users.id, classBookings.memberId))
        .where(
          and(
            eq(classBookings.sessionId, sessionId),
            inArray(classBookings.status, ['booked', 'attended', 'no_show']),
          ),
        )
        .orderBy(asc(users.firstName), asc(users.lastName), asc(classBookings.id));
      const urls = await this.photos.urlsFor(
        tx,
        rows.map((r) => r.memberId),
      );
      return rows.map((r) => ({
        bookingId: r.bookingId,
        status: r.status,
        member: {
          id: r.memberId,
          firstName: r.firstName,
          lastName: r.lastName,
          photoUrl: urls.get(r.memberId) ?? null,
        },
      }));
    });
  }

  /** A member's bookings: upcoming ones (not ended, still booked) soonest first, or history newest first. */
  async mine(gymId: string, memberId: string, upcoming: boolean): Promise<BookingView[]> {
    return withGym(gymId, async (tx) => {
      const now = this.clock.now();
      const rows = await tx
        .select({
          b: classBookings,
          s: classSessions,
          typeName: classTypes.name,
          typeNameEn: classTypes.nameEn,
          kind: memberships.kind,
          trainerFirstName: users.firstName,
        })
        .from(classBookings)
        .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
        .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
        .leftJoin(memberships, eq(memberships.id, classBookings.membershipId))
        .leftJoin(users, eq(users.id, classSessions.trainerId))
        .where(
          and(
            eq(classBookings.memberId, memberId),
            upcoming
              ? and(eq(classBookings.status, 'booked'), gt(classSessions.endsAtUtc, now))
              : undefined,
          ),
        )
        .orderBy(
          upcoming ? asc(classSessions.startsAtUtc) : desc(classSessions.startsAtUtc),
          asc(classBookings.id),
        )
        .limit(upcoming ? 200 : 100);
      return rows.map(
        (r): BookingView => ({
          id: r.b.id,
          status: r.b.status,
          usesEntry: r.kind === 'classes',
          session: {
            id: r.s.id,
            date: r.s.date,
            startsAt: hhmm(r.s.startsAt),
            endsAt: hhmm(r.s.endsAt),
            type: { id: r.s.classTypeId, name: r.typeName, nameEn: r.typeNameEn },
            trainer:
              r.s.trainerId && r.trainerFirstName
                ? { id: r.s.trainerId, firstName: r.trainerFirstName }
                : null,
            room: r.s.room,
            capacity: r.s.capacity,
            cancelled: r.s.cancelledAt !== null,
          },
        }),
      );
    });
  }
}
