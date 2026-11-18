import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CLASS_HORIZON_DAYS,
  classEndTime,
  type ClassSeries,
  type ClassSessionQuery,
  type ClassSessionView,
  type ClassTypeView,
  type CreateClassSeries,
  type CreateClassSession,
  type CreateClassType,
  type UpdateClassType,
  type Weekday,
} from '@gym/shared';
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { systemDb } from '../db/client';
import { classSeries, classSessions, classTypes, gymRoles, gyms, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { addDays, todayIn } from '../memberships/dates';
import { lockTrainer } from '../trainers/trainer-access';
import { localToUtc, materialiseSeries } from './materialise';

const hhmm = (t: string): string => t.slice(0, 5);

const typeView = (r: typeof classTypes.$inferSelect): ClassTypeView => ({
  id: r.id,
  name: r.name,
  nameEn: r.nameEn,
  description: r.description,
  defaultCapacity: r.defaultCapacity,
  defaultDurationMinutes: r.defaultDurationMinutes,
  archived: r.archivedAt !== null,
});

const seriesOf = (r: typeof classSeries.$inferSelect): ClassSeries => ({
  id: r.id,
  classTypeId: r.classTypeId,
  weekday: r.weekday as Weekday,
  startsAt: hhmm(r.startsAt),
  durationMinutes: r.durationMinutes,
  capacity: r.capacity,
  trainerId: r.trainerId,
  room: r.room,
  validFrom: r.validFrom,
  validUntil: r.validUntil,
});

@Injectable()
export class TimetableService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private async gymClock(tx: Tx, gymId: string): Promise<{ tz: string; today: string }> {
    const [g] = await tx.select({ tz: gyms.timezone }).from(gyms).where(eq(gyms.id, gymId));
    return { tz: g!.tz, today: todayIn(g!.tz, this.clock.now()) };
  }

  // --- class types ---------------------------------------------------------------------------

  listTypes(gymId: string): Promise<ClassTypeView[]> {
    return withGym(gymId, async (tx) =>
      (await tx.select().from(classTypes).orderBy(asc(classTypes.name), asc(classTypes.id))).map(
        typeView,
      ),
    );
  }

  async createType(gymId: string, actorId: string, b: CreateClassType): Promise<ClassTypeView> {
    return withGym(gymId, async (tx) => {
      const [row] = await tx
        .insert(classTypes)
        .values({
          gymId,
          name: b.name,
          nameEn: b.nameEn ?? null,
          description: b.description ?? null,
          defaultCapacity: b.defaultCapacity,
          defaultDurationMinutes: b.defaultDurationMinutes,
        })
        .returning();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_type.created',
        entity: 'class_type',
        entityId: row!.id,
        data: { name: b.name },
      });
      return typeView(row!);
    });
  }

  async updateType(
    gymId: string,
    actorId: string,
    id: string,
    b: UpdateClassType,
  ): Promise<ClassTypeView> {
    return withGym(gymId, async (tx) => {
      const [row] = await tx
        .update(classTypes)
        .set({
          ...(b.name !== undefined && { name: b.name }),
          ...(b.nameEn !== undefined && { nameEn: b.nameEn }),
          ...(b.description !== undefined && { description: b.description }),
          ...(b.defaultCapacity !== undefined && { defaultCapacity: b.defaultCapacity }),
          ...(b.defaultDurationMinutes !== undefined && {
            defaultDurationMinutes: b.defaultDurationMinutes,
          }),
        })
        .where(eq(classTypes.id, id))
        .returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_type.updated',
        entity: 'class_type',
        entityId: id,
        data: { fields: Object.keys(b) },
      });
      return typeView(row);
    });
  }

  async archiveType(gymId: string, actorId: string, id: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [row] = await tx
        .update(classTypes)
        .set({ archivedAt: new Date() })
        .where(and(eq(classTypes.id, id), isNull(classTypes.archivedAt)))
        .returning({ id: classTypes.id });
      if (!row) {
        const [exists] = await tx
          .select({ id: classTypes.id })
          .from(classTypes)
          .where(eq(classTypes.id, id));
        if (!exists) throw new NotFoundException();
        return; // already archived
      }
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_type.archived',
        entity: 'class_type',
        entityId: id,
      });
    });
  }

  private async requireType(tx: Tx, id: string): Promise<void> {
    const [t] = await tx
      .select({ id: classTypes.id })
      .from(classTypes)
      .where(and(eq(classTypes.id, id), isNull(classTypes.archivedAt)));
    if (!t) throw new NotFoundException('No such class type');
  }

  /** Locks the trainer (so removing their role serialises with this) and checks they hold the role. */
  private async requireTrainer(tx: Tx, trainerId: string | null | undefined): Promise<void> {
    if (!trainerId) return;
    await lockTrainer(tx, trainerId);
    const [r] = await tx
      .select({ role: gymRoles.role })
      .from(gymRoles)
      .where(and(eq(gymRoles.userId, trainerId), eq(gymRoles.role, 'trainer')))
      .limit(1);
    if (!r) throw new NotFoundException('No such trainer');
  }

  // --- materialisation -----------------------------------------------------------------------

  /** Creates the missing sessions for today … today + 27 of one gym, inside `tx`. Idempotent. */
  async materialiseInTx(tx: Tx, gymId: string): Promise<number> {
    const { tz, today } = await this.gymClock(tx, gymId);
    const to = addDays(today, CLASS_HORIZON_DAYS - 1);
    const series = await tx
      .select()
      .from(classSeries)
      .where(
        and(
          lte(classSeries.validFrom, to),
          or(isNull(classSeries.validUntil), gte(classSeries.validUntil, today)),
        ),
      )
      // Waits for an endSeries in flight (it locks the row FOR UPDATE), so no session is
      // created past a valid_until that is being set.
      .for('share');
    if (!series.length) return 0;
    const existing = await tx
      .select({ seriesId: classSessions.seriesId, date: classSessions.date })
      .from(classSessions)
      .where(
        and(
          inArray(
            classSessions.seriesId,
            series.map((s) => s.id),
          ),
          gte(classSessions.date, today),
          lte(classSessions.date, to),
        ),
      );
    const fresh = materialiseSeries(series.map(seriesOf), existing, today, to);
    if (!fresh.length) return 0;
    const inserted = await tx
      .insert(classSessions)
      .values(
        fresh.map((f) => ({
          gymId,
          classTypeId: f.classTypeId,
          seriesId: f.seriesId,
          date: f.date,
          startsAt: f.startsAt,
          endsAt: f.endsAt,
          startsAtUtc: localToUtc(f.date, f.startsAt, tz),
          endsAtUtc: localToUtc(f.date, f.endsAt, tz),
          capacity: f.capacity,
          trainerId: f.trainerId,
          room: f.room,
        })),
      )
      .onConflictDoNothing({ target: [classSessions.seriesId, classSessions.date] })
      .returning({ id: classSessions.id });
    return inserted.length;
  }

  materialiseGym(gymId: string): Promise<number> {
    return withGym(gymId, (tx) => this.materialiseInTx(tx, gymId));
  }

  /** The hourly job: every gym. A failing gym is logged and does not stop the others. */
  async materialiseAll(_now: Date): Promise<{ gyms: number; created: number; failed: number }> {
    const all = await systemDb.select({ id: gyms.id }).from(gyms);
    const total = { gyms: 0, created: 0, failed: 0 };
    for (const { id } of all) {
      try {
        total.created += await this.materialiseGym(id);
      } catch (err) {
        console.error(`[classes] gym ${id}: ${(err as Error).message}`);
        total.failed++;
      }
      total.gyms++;
    }
    return total;
  }

  // --- series --------------------------------------------------------------------------------

  async createSeries(
    gymId: string,
    actorId: string,
    b: CreateClassSeries,
  ): Promise<{ id: string }> {
    return withGym(gymId, async (tx) => {
      const { today } = await this.gymClock(tx, gymId);
      if (b.validFrom < today) throw new BadRequestException('A series cannot start in the past');
      await this.requireType(tx, b.classTypeId);
      await this.requireTrainer(tx, b.trainerId);
      const [row] = await tx
        .insert(classSeries)
        .values({
          gymId,
          classTypeId: b.classTypeId,
          weekday: b.weekday,
          startsAt: b.startsAt,
          durationMinutes: b.durationMinutes,
          capacity: b.capacity,
          trainerId: b.trainerId ?? null,
          room: b.room ?? null,
          validFrom: b.validFrom,
          validUntil: b.validUntil ?? null,
          createdBy: actorId,
        })
        .returning({ id: classSeries.id });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_series.created',
        entity: 'class_series',
        entityId: row!.id,
        data: {
          classTypeId: b.classTypeId,
          weekday: b.weekday,
          startsAt: b.startsAt,
          durationMinutes: b.durationMinutes,
          capacity: b.capacity,
          validFrom: b.validFrom,
          validUntil: b.validUntil ?? null,
        },
      });
      await this.materialiseInTx(tx, gymId);
      return { id: row!.id };
    });
  }

  /**
   * Ends a series after `lastDate`. Sessions after it that have not started are retired (removed,
   * or cancelled when they have bookings); sessions that started or are past never change.
   * `lastDate` may be as early as the day before the series started (an emptied series).
   */
  async endSeries(gymId: string, actorId: string, id: string, lastDate: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const { today } = await this.gymClock(tx, gymId);
      const [s] = await tx.select().from(classSeries).where(eq(classSeries.id, id)).for('update');
      if (!s) throw new NotFoundException();
      if (lastDate < addDays(today, -1)) throw new BadRequestException('Past days cannot change');
      if (lastDate < addDays(s.validFrom, -1)) {
        throw new BadRequestException('Ends before it starts');
      }
      if (s.validUntil !== null && lastDate > s.validUntil) {
        throw new BadRequestException('A series cannot be extended');
      }
      await tx.update(classSeries).set({ validUntil: lastDate }).where(eq(classSeries.id, id));
      const doomed = await tx
        .select({ id: classSessions.id })
        .from(classSessions)
        .where(
          and(
            eq(classSessions.seriesId, id),
            gt(classSessions.date, lastDate),
            gt(classSessions.startsAtUtc, this.clock.now()),
          ),
        );
      await this.retireSessions(
        tx,
        gymId,
        actorId,
        doomed.map((d) => d.id),
        'series_ended',
      );
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_series.ended',
        entity: 'class_series',
        entityId: id,
        data: { lastDate },
      });
    });
  }

  /**
   * Removes sessions nobody booked and cancels (with their bookings) the ones that have bookings.
   * Task 2 extends this with the bookings; until then no session has any.
   */
  protected async retireSessions(
    tx: Tx,
    _gymId: string,
    _actorId: string,
    sessionIds: string[],
    _reason: string,
  ): Promise<void> {
    if (!sessionIds.length) return;
    await tx.delete(classSessions).where(inArray(classSessions.id, sessionIds));
  }

  // --- sessions ------------------------------------------------------------------------------

  async createSession(
    gymId: string,
    actorId: string,
    b: CreateClassSession,
  ): Promise<{ id: string }> {
    return withGym(gymId, async (tx) => {
      const { tz, today } = await this.gymClock(tx, gymId);
      if (b.date < today) throw new BadRequestException('Past days cannot change');
      await this.requireType(tx, b.classTypeId);
      await this.requireTrainer(tx, b.trainerId);
      const endsAt = classEndTime(b.startsAt, b.durationMinutes)!;
      const [row] = await tx
        .insert(classSessions)
        .values({
          gymId,
          classTypeId: b.classTypeId,
          seriesId: null,
          date: b.date,
          startsAt: b.startsAt,
          endsAt,
          startsAtUtc: localToUtc(b.date, b.startsAt, tz),
          endsAtUtc: localToUtc(b.date, endsAt, tz),
          capacity: b.capacity,
          trainerId: b.trainerId ?? null,
          room: b.room ?? null,
        })
        .returning({ id: classSessions.id });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_session.created',
        entity: 'class_session',
        entityId: row!.id,
        data: { date: b.date, startsAt: b.startsAt, classTypeId: b.classTypeId },
      });
      return { id: row!.id };
    });
  }

  /** Cancels a session that has not ended. Cancelling twice is a no-op. */
  async cancelSession(
    gymId: string,
    actorId: string,
    id: string,
    reason: string | undefined,
  ): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [s] = await tx
        .select()
        .from(classSessions)
        .where(eq(classSessions.id, id))
        .for('update');
      if (!s) throw new NotFoundException();
      if (s.cancelledAt !== null) return;
      if (s.endsAtUtc <= this.clock.now()) throw new ConflictException('The class is over');
      await tx
        .update(classSessions)
        .set({ cancelledAt: this.clock.now(), cancelReason: reason ?? null })
        .where(eq(classSessions.id, id));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'class_session.cancelled',
        entity: 'class_session',
        entityId: id,
        data: { date: s.date, startsAt: hhmm(s.startsAt), reason: reason ?? null },
      });
    });
  }

  /** Sessions with `date` in `q.from..q.to`, soonest first. */
  list(gymId: string, _userId: string, q: ClassSessionQuery): Promise<ClassSessionView[]> {
    return withGym(gymId, async (tx) => {
      const rows = await tx
        .select({
          s: classSessions,
          typeName: classTypes.name,
          typeNameEn: classTypes.nameEn,
          trainerFirstName: users.firstName,
        })
        .from(classSessions)
        .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
        .leftJoin(users, eq(users.id, classSessions.trainerId))
        .where(and(gte(classSessions.date, q.from), lte(classSessions.date, q.to)))
        .orderBy(asc(classSessions.date), asc(classSessions.startsAt), asc(classSessions.id));
      return rows.map(
        (r): ClassSessionView => ({
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
          booked: 0,
          cancelled: r.s.cancelledAt !== null,
          seriesId: r.s.seriesId,
        }),
      );
    });
  }

  /**
   * For role removal (inside its transaction): the trainer's series and their sessions that have
   * not started lose the trainer; the classes keep running (shown as "no trainer").
   */
  async removeTrainerFrom(tx: Tx, _gymId: string, userId: string): Promise<void> {
    await tx.update(classSeries).set({ trainerId: null }).where(eq(classSeries.trainerId, userId));
    await tx
      .update(classSessions)
      .set({ trainerId: null })
      .where(
        and(eq(classSessions.trainerId, userId), gt(classSessions.startsAtUtc, this.clock.now())),
      );
  }
}
