import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateShift,
  CreateShiftSeries,
  ExpandedShift,
  Occurrence,
  OnDutyPerson,
  ScheduleQuery,
  ScheduleResponse,
  ScheduleStaff,
  ShiftRow,
  ShiftSeries,
  UpdateShift,
  Weekday,
} from '@gym/shared';
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { gymRoles, gyms, shiftSeries, shifts, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { addDays, todayIn } from '../memberships/dates';
import { expandShifts, isOnDuty, isoWeekday } from './expand';

const STAFF_ROLES = ['owner', 'reception', 'trainer'] as const;
type StaffRoleName = (typeof STAFF_ROLES)[number];
const hhmm = (t: string): string => t.slice(0, 5);

/** The gym's current date and local time (HH:MM). */
async function gymNow(tx: Tx, gymId: string, now: Date): Promise<{ today: string; time: string }> {
  const [g] = await tx.select({ tz: gyms.timezone }).from(gyms).where(eq(gyms.id, gymId));
  const tz = g!.tz;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return { today: todayIn(tz, now), time };
}

const seriesOf = (r: typeof shiftSeries.$inferSelect): ShiftSeries => ({
  id: r.id,
  staffId: r.staffId,
  weekday: r.weekday as Weekday,
  startsAt: hhmm(r.startsAt),
  endsAt: hhmm(r.endsAt),
  validFrom: r.validFrom,
  validUntil: r.validUntil,
});
const rowOf = (r: typeof shifts.$inferSelect): ShiftRow => ({
  id: r.id,
  staffId: r.staffId,
  date: r.date,
  startsAt: hhmm(r.startsAt),
  endsAt: hhmm(r.endsAt),
  seriesId: r.seriesId,
  cancelled: r.cancelled,
  note: r.note,
});

/** Expanded shifts for `from..to`, optionally for one person. */
async function expandRange(
  tx: Tx,
  from: string,
  to: string,
  staffId?: string,
): Promise<ExpandedShift[]> {
  const series = await tx
    .select()
    .from(shiftSeries)
    .where(
      and(
        staffId ? eq(shiftSeries.staffId, staffId) : undefined,
        lte(shiftSeries.validFrom, to),
        or(isNull(shiftSeries.validUntil), gte(shiftSeries.validUntil, from)),
      ),
    );
  const rows = await tx
    .select()
    .from(shifts)
    .where(
      and(
        staffId ? eq(shifts.staffId, staffId) : undefined,
        gte(shifts.date, from),
        lte(shifts.date, to),
      ),
    );
  return expandShifts(series.map(seriesOf), rows.map(rowOf), from, to);
}

/** Staff of the gym with their roles and names (optionally only some people). */
async function staffOf(tx: Tx, only?: string[]): Promise<ScheduleStaff[]> {
  if (only && !only.length) return [];
  const rows = await tx
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: gymRoles.role,
    })
    .from(gymRoles)
    .innerJoin(users, eq(users.id, gymRoles.userId))
    .where(
      and(inArray(gymRoles.role, [...STAFF_ROLES]), only ? inArray(users.id, only) : undefined),
    )
    .orderBy(asc(users.firstName), asc(users.lastName), asc(users.id));
  const byId = new Map<string, ScheduleStaff>();
  for (const r of rows) {
    const existing = byId.get(r.userId);
    if (existing) existing.roles.push(r.role as StaffRoleName);
    else {
      byId.set(r.userId, {
        userId: r.userId,
        firstName: r.firstName,
        lastName: r.lastName,
        roles: [r.role as StaffRoleName],
      });
    }
  }
  return [...byId.values()];
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async schedule(gymId: string, q: ScheduleQuery): Promise<ScheduleResponse> {
    return withGym(gymId, async (tx) => ({
      shifts: await expandRange(tx, q.from, q.to),
      staff: await staffOf(tx),
    }));
  }

  mySchedule(gymId: string, userId: string, q: ScheduleQuery): Promise<ExpandedShift[]> {
    return withGym(gymId, (tx) => expandRange(tx, q.from, q.to, userId));
  }

  /** Staff whose shift today covers the gym's current local time (start inclusive, end exclusive). */
  async onDuty(gymId: string): Promise<OnDutyPerson[]> {
    return withGym(gymId, async (tx) => {
      const { today, time } = await gymNow(tx, gymId, this.clock.now());
      const todays = await expandRange(tx, today, today);
      const staff = await staffOf(tx, [...new Set(todays.map((s) => s.staffId))]);
      return staff.flatMap((p) => {
        const current = todays.find(
          (s) => s.staffId === p.userId && s.startsAt <= time && time < s.endsAt,
        );
        return current && isOnDuty(todays, p.userId, today, time)
          ? [{ ...p, until: current.endsAt }]
          : [];
      });
    });
  }

  /** Which of these staff members are on a shift right now (gym time; end exclusive). */
  async staffOnDutyNow(tx: Tx, gymId: string, staffIds: string[]): Promise<Set<string>> {
    if (!staffIds.length) return new Set();
    const { today, time } = await gymNow(tx, gymId, this.clock.now());
    const todays = await expandRange(tx, today, today);
    return new Set(staffIds.filter((id) => isOnDuty(todays, id, today, time)));
  }

  private async requireStaff(tx: Tx, staffId: string): Promise<void> {
    const [r] = await tx
      .select({ role: gymRoles.role })
      .from(gymRoles)
      .where(and(eq(gymRoles.userId, staffId), inArray(gymRoles.role, [...STAFF_ROLES])))
      .limit(1);
    if (!r) throw new NotFoundException('No such staff member');
  }

  async createSeries(
    gymId: string,
    actorId: string,
    body: CreateShiftSeries,
  ): Promise<{ id: string }> {
    return withGym(gymId, async (tx) => {
      const { today } = await gymNow(tx, gymId, this.clock.now());
      if (body.validFrom < today)
        throw new BadRequestException('A series cannot start in the past');
      await this.requireStaff(tx, body.staffId);
      const until = body.validUntil ?? null;
      // Series of one person may share a weekday (split shifts) but not overlap in time.
      const clash = await tx
        .select({ id: shiftSeries.id })
        .from(shiftSeries)
        .where(
          and(
            eq(shiftSeries.staffId, body.staffId),
            eq(shiftSeries.weekday, body.weekday),
            lt(shiftSeries.startsAt, body.endsAt),
            gt(shiftSeries.endsAt, body.startsAt),
            until ? lte(shiftSeries.validFrom, until) : undefined,
            or(isNull(shiftSeries.validUntil), gte(shiftSeries.validUntil, body.validFrom)),
          ),
        )
        .limit(1);
      if (clash.length) throw new ConflictException('Overlaps another weekly shift');
      const [row] = await tx
        .insert(shiftSeries)
        .values({
          gymId,
          staffId: body.staffId,
          weekday: body.weekday,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          validFrom: body.validFrom,
          validUntil: until,
          createdBy: actorId,
        })
        .returning({ id: shiftSeries.id });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'shift_series.created',
        entity: 'shift_series',
        entityId: row!.id,
        data: {
          staffId: body.staffId,
          weekday: body.weekday,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          validFrom: body.validFrom,
          validUntil: until,
        },
      });
      return { id: row!.id };
    });
  }

  async endSeries(gymId: string, actorId: string, id: string, lastDate: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const { today } = await gymNow(tx, gymId, this.clock.now());
      const [s] = await tx.select().from(shiftSeries).where(eq(shiftSeries.id, id)).for('update');
      if (!s) throw new NotFoundException();
      if (lastDate < addDays(today, -1)) throw new BadRequestException('Past days cannot change');
      if (lastDate < s.validFrom) {
        // "From validFrom on" of a series that has not produced a past day: delete it whole, so a
        // weekly shift can be changed from its very first day.
        if (s.validFrom < today) throw new BadRequestException('Ends before it starts');
        await tx.delete(shifts).where(eq(shifts.seriesId, id));
        await tx.delete(shiftSeries).where(eq(shiftSeries.id, id));
        await this.audit.record(tx, {
          gymId,
          actorId,
          action: 'shift_series.ended',
          entity: 'shift_series',
          entityId: id,
          data: { staffId: s.staffId, lastDate, deleted: true },
        });
        return;
      }
      if (s.validUntil !== null && lastDate > s.validUntil) {
        throw new BadRequestException('A series cannot be extended');
      }
      await tx.update(shiftSeries).set({ validUntil: lastDate }).where(eq(shiftSeries.id, id));
      await tx.delete(shifts).where(and(eq(shifts.seriesId, id), gt(shifts.date, lastDate)));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'shift_series.ended',
        entity: 'shift_series',
        entityId: id,
        data: { staffId: s.staffId, lastDate },
      });
    });
  }

  /** One-off shift. */
  async createShift(gymId: string, actorId: string, body: CreateShift): Promise<{ id: string }> {
    return withGym(gymId, async (tx) => {
      const { today } = await gymNow(tx, gymId, this.clock.now());
      await this.requireStaff(tx, body.staffId);
      if (body.date < today) throw new ConflictException('Past days cannot change');
      const [row] = await tx
        .insert(shifts)
        .values({
          gymId,
          staffId: body.staffId,
          date: body.date,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          note: body.note ?? null,
          createdBy: actorId,
        })
        .returning({ id: shifts.id });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'shift.created',
        entity: 'shift',
        entityId: row!.id,
        data: {
          staffId: body.staffId,
          date: body.date,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
        },
      });
      return { id: row!.id };
    });
  }

  /** A one-off shift of this gym that has not passed; 404 / 400 (belongs to a series) / 409 (past). */
  private async editableOneOff(tx: Tx, gymId: string, id: string) {
    const [row] = await tx.select().from(shifts).where(eq(shifts.id, id)).for('update');
    if (!row) throw new NotFoundException();
    if (row.seriesId !== null) {
      throw new BadRequestException('Change this through its weekly series');
    }
    const { today } = await gymNow(tx, gymId, this.clock.now());
    if (row.date < today) throw new ConflictException('Past days cannot change');
    return row;
  }

  async updateShift(
    gymId: string,
    actorId: string,
    id: string,
    body: UpdateShift,
  ): Promise<{ id: string }> {
    return withGym(gymId, async (tx) => {
      const row = await this.editableOneOff(tx, gymId, id);
      const startsAt = body.startsAt ?? hhmm(row.startsAt);
      const endsAt = body.endsAt ?? hhmm(row.endsAt);
      if (endsAt <= startsAt) throw new BadRequestException('Must end after it starts');
      await tx
        .update(shifts)
        .set({ startsAt, endsAt, note: body.note === undefined ? row.note : body.note })
        .where(eq(shifts.id, id));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'shift.updated',
        entity: 'shift',
        entityId: id,
        data: { staffId: row.staffId, date: row.date, startsAt, endsAt },
      });
      return { id };
    });
  }

  async deleteShift(gymId: string, actorId: string, id: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const row = await this.editableOneOff(tx, gymId, id);
      await tx.delete(shifts).where(eq(shifts.id, id));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'shift.cancelled',
        entity: 'shift',
        entityId: id,
        data: { staffId: row.staffId, date: row.date },
      });
    });
  }

  /** Overrides one occurrence of a series: other times, or cancelled. */
  async setOccurrence(
    gymId: string,
    actorId: string,
    seriesId: string,
    date: string,
    body: Occurrence,
  ): Promise<{ id: string }> {
    return withGym(gymId, async (tx) => {
      const [s] = await tx.select().from(shiftSeries).where(eq(shiftSeries.id, seriesId));
      if (!s) throw new NotFoundException();
      const { today } = await gymNow(tx, gymId, this.clock.now());
      if (date < today) throw new ConflictException('Past days cannot change');
      if (
        isoWeekday(date) !== s.weekday ||
        date < s.validFrom ||
        (s.validUntil !== null && date > s.validUntil)
      ) {
        throw new BadRequestException('The series does not run on that date');
      }
      const values =
        'cancelled' in body
          ? { startsAt: hhmm(s.startsAt), endsAt: hhmm(s.endsAt), cancelled: true, note: null }
          : {
              startsAt: body.startsAt,
              endsAt: body.endsAt,
              cancelled: false,
              note: body.note ?? null,
            };
      const [row] = await tx
        .insert(shifts)
        .values({ gymId, staffId: s.staffId, date, seriesId, createdBy: actorId, ...values })
        .onConflictDoUpdate({ target: [shifts.seriesId, shifts.date], set: values })
        .returning({ id: shifts.id });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: values.cancelled ? 'shift.cancelled' : 'shift.updated',
        entity: 'shift',
        entityId: row!.id,
        data: {
          staffId: s.staffId,
          seriesId,
          date,
          ...(values.cancelled ? {} : { startsAt: values.startsAt, endsAt: values.endsAt }),
        },
      });
      return { id: row!.id };
    });
  }

  /**
   * For role removal (inside its transaction): deletes the person's shifts dated today or later,
   * deletes series that have not started and ends running ones at yesterday, so past days keep
   * their history.
   */
  async removeFutureShifts(tx: Tx, gymId: string, userId: string): Promise<void> {
    const { today } = await gymNow(tx, gymId, this.clock.now());
    await tx.delete(shifts).where(and(eq(shifts.staffId, userId), gte(shifts.date, today)));
    await tx
      .delete(shiftSeries)
      .where(and(eq(shiftSeries.staffId, userId), gte(shiftSeries.validFrom, today)));
    await tx
      .update(shiftSeries)
      .set({ validUntil: addDays(today, -1) })
      .where(
        and(
          eq(shiftSeries.staffId, userId),
          or(isNull(shiftSeries.validUntil), gte(shiftSeries.validUntil, today)),
        ),
      );
  }
}
