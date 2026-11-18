import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GymRole,
  LastPerformance,
  Measure,
  SessionListQuery,
  SessionUpsert,
  SetUpsert,
  WorkoutSession,
  WorkoutSet,
} from '@gym/shared';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import {
  exercises,
  gyms,
  planDays,
  planExercises,
  plans,
  workoutSessions,
  workoutSets,
} from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { gymToday } from '../memberships/memberships.service';
import { todayIn } from '../memberships/dates';
import { type HealthAccess, healthAccess } from './health-access';

export interface Caller {
  userId: string;
  roles: GymRole[];
}

/** A session with no `finished_at` for this long counts as finished at its last set. */
const STALE_MS = 12 * 60 * 60 * 1000;

type SessionRow = typeof workoutSessions.$inferSelect;
type SetRow = typeof workoutSets.$inferSelect;

const toSet = (r: SetRow): WorkoutSet => ({
  id: r.id,
  exerciseId: r.exerciseId,
  planExerciseId: r.planExerciseId,
  measure: r.measure as Measure,
  setIndex: r.setIndex,
  reps: r.reps,
  weightKg: r.weightKg === null ? null : Number(r.weightKg),
  durationSeconds: r.durationSeconds,
  done: r.done,
  loggedAt: r.loggedAt.toISOString(),
});

function toSession(r: SessionRow, sets: SetRow[], now: Date): WorkoutSession {
  const ordered = [...sets].sort(
    (a, b) => a.exerciseId.localeCompare(b.exerciseId) || a.setIndex - b.setIndex,
  );
  let finished = r.finishedAt;
  if (!finished && now.getTime() - r.startedAt.getTime() > STALE_MS) {
    const last = sets.reduce<Date | null>((m, s) => (!m || s.loggedAt > m ? s.loggedAt : m), null);
    finished = last && last > r.startedAt ? last : r.startedAt;
  }
  return {
    id: r.id,
    memberId: r.memberId,
    planId: r.planId,
    planDayId: r.planDayId,
    startedAt: r.startedAt.toISOString(),
    finishedAt: finished ? finished.toISOString() : null,
    notes: r.notes,
    sets: ordered.map(toSet),
  };
}

function errorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string; constraint?: string } };
  return err.code ?? err.cause?.code;
}

@Injectable()
export class WorkoutsService {
  constructor(private readonly clock: Clock) {}

  /** Read access to the member's log, or 404. */
  private async access(
    tx: Tx,
    gymId: string,
    caller: Caller,
    memberId: string,
    need: 'read' | 'writeSessions',
  ): Promise<HealthAccess> {
    const today = await gymToday(tx, gymId, this.clock.now());
    const a = await healthAccess(tx, gymId, caller, memberId, today);
    if (!a.read) throw new NotFoundException();
    if (need === 'writeSessions' && !a.writeSessions) throw new ForbiddenException();
    return a;
  }

  /**
   * Creates or updates a session by its client id. Replays are harmless: a session that already
   * exists keeps its start, plan and finish (the offline queue may resend an old body after the
   * session was closed), and only a first PUT applies the one-open-session rule.
   */
  upsertSession(
    gymId: string,
    caller: Caller,
    memberId: string,
    sessionId: string,
    body: SessionUpsert,
  ): Promise<WorkoutSession> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId, 'writeSessions');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'workout:' + memberId}))`);

      let [existing] = await tx
        .select()
        .from(workoutSessions)
        .where(eq(workoutSessions.id, sessionId));
      if (!existing) {
        // Plan references are checked only when the session is created: a replay may name a plan
        // or day the trainer has deleted since (the stored link is then null).
        const { planId, planDayId } = await this.checkPlanRefs(tx, memberId, body);
        const startedAt = new Date(body.startedAt);
        const open = await tx
          .select({ id: workoutSessions.id, startedAt: workoutSessions.startedAt })
          .from(workoutSessions)
          .where(and(eq(workoutSessions.memberId, memberId), isNull(workoutSessions.finishedAt)));
        // A session that begins before the open one (an old one arriving late) is closed at once.
        const newerOpen = open.some((o) => o.startedAt > startedAt);
        const finishedAt = body.finishedAt
          ? new Date(body.finishedAt)
          : newerOpen
            ? startedAt
            : null;
        const inserted = await tx
          .insert(workoutSessions)
          .values({
            id: sessionId,
            gymId,
            memberId,
            planId,
            planDayId,
            startedAt,
            finishedAt,
            notes: body.notes ?? null,
          })
          .onConflictDoNothing({ target: workoutSessions.id })
          .returning();
        if (inserted[0]) {
          for (const o of open.filter((x) => x.startedAt <= startedAt)) {
            await this.closeAtLastSet(tx, o.id);
          }
          existing = inserted[0];
        } else {
          // Someone created it between the read and the insert (same gym) or it is another gym's.
          [existing] = await tx
            .select()
            .from(workoutSessions)
            .where(eq(workoutSessions.id, sessionId));
        }
      } else if (existing.memberId === memberId) {
        const sameShape =
          existing.startedAt.getTime() === new Date(body.startedAt).getTime() &&
          (existing.planId === null || body.planId == null || existing.planId === body.planId) &&
          (existing.planDayId === null || existing.planDayId === (body.planDayId ?? null));
        if (!sameShape) throw new ConflictException('Session already exists with other details');
        const patch: Partial<typeof workoutSessions.$inferInsert> = {};
        if (body.notes !== undefined && body.notes !== existing.notes) patch.notes = body.notes;
        if (body.finishedAt && !existing.finishedAt) {
          patch.finishedAt = new Date(body.finishedAt);
        }
        if (Object.keys(patch).length) {
          [existing] = await tx
            .update(workoutSessions)
            .set({ ...patch, updatedAt: this.clock.now() })
            .where(eq(workoutSessions.id, sessionId))
            .returning();
        }
      }
      if (!existing || existing.memberId !== memberId) throw new NotFoundException();
      return this.load(tx, existing);
    });
  }

  /** The plan and plan day must be the member's own, and the day must belong to the plan. */
  private async checkPlanRefs(
    tx: Tx,
    memberId: string,
    body: SessionUpsert,
  ): Promise<{ planId: string | null; planDayId: string | null }> {
    const bad = () => new BadRequestException({ message: 'Unknown plan or plan day' });
    let planId = body.planId ?? null;
    const planDayId = body.planDayId ?? null;
    if (planDayId) {
      const [day] = await tx
        .select({ planId: planDays.planId })
        .from(planDays)
        .where(eq(planDays.id, planDayId));
      if (!day || (planId && planId !== day.planId)) throw bad();
      planId = day.planId;
    }
    if (planId) {
      const [plan] = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.memberId, memberId)));
      if (!plan) throw bad();
    }
    return { planId, planDayId };
  }

  private async closeAtLastSet(tx: Tx, sessionId: string): Promise<void> {
    await tx
      .update(workoutSessions)
      .set({
        // greatest(): a set stamped before the session began (a wrong phone clock) must not
        // break the finished_at >= started_at check.
        finishedAt: sql`greatest(${workoutSessions.startedAt}, coalesce((select max(${workoutSets.loggedAt}) from ${workoutSets} where ${workoutSets.sessionId} = ${workoutSessions.id}), ${workoutSessions.startedAt}))`,
        updatedAt: this.clock.now(),
      })
      .where(eq(workoutSessions.id, sessionId));
  }

  private async load(tx: Tx, row: SessionRow): Promise<WorkoutSession> {
    const sets = await tx.select().from(workoutSets).where(eq(workoutSets.sessionId, row.id));
    return toSession(row, sets, this.clock.now());
  }

  async upsertSet(
    gymId: string,
    caller: Caller,
    memberId: string,
    sessionId: string,
    setId: string,
    body: SetUpsert,
  ): Promise<void> {
    await withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId, 'writeSessions');
      // One writer per member at a time: a retry sent while the first request is still in flight
      // waits, then finds the stored set instead of racing the insert.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'workout:' + memberId}))`);
      const session = await this.ownSession(tx, memberId, sessionId);

      const [existing] = await tx.select().from(workoutSets).where(eq(workoutSets.id, setId));
      if (
        existing &&
        (existing.sessionId !== sessionId || existing.exerciseId !== body.exerciseId)
      ) {
        // Another session's set (or another member's): never moved, never overwritten.
        throw existing.sessionId !== sessionId
          ? new NotFoundException()
          : new ConflictException('The set belongs to another exercise');
      }
      if (existing && existing.setIndex !== body.setIndex) {
        throw new ConflictException('The set has another position');
      }

      const [exercise] = await tx
        .select({ id: exercises.id, measure: exercises.measure, archivedAt: exercises.archivedAt })
        .from(exercises)
        .where(eq(exercises.id, body.exerciseId));
      // An exercise archived meanwhile can still receive sets already started (the offline queue).
      if (!exercise || (exercise.archivedAt && !existing)) throw new NotFoundException();

      const measure = (existing?.measure ?? exercise.measure) as Measure;
      this.checkValues(measure, body);
      // A stored set keeps its plan link (it may have been nulled by a plan edit); only a new
      // set is linked, and only to a plan exercise that still exists.
      const planExerciseId =
        !existing && body.planExerciseId
          ? await this.checkPlanExercise(tx, session, body.planExerciseId, body.exerciseId)
          : null;

      const values = {
        reps: body.reps ?? null,
        weightKg: body.weightKg == null ? null : String(body.weightKg),
        durationSeconds: body.durationSeconds ?? null,
        done: body.done,
        loggedAt: new Date(body.loggedAt),
      };
      if (existing) {
        await tx
          .update(workoutSets)
          .set({ ...values, updatedAt: this.clock.now() })
          .where(eq(workoutSets.id, setId));
        return;
      }
      try {
        const inserted = await tx
          .insert(workoutSets)
          .values({
            id: setId,
            gymId,
            sessionId,
            exerciseId: body.exerciseId,
            measure,
            setIndex: body.setIndex,
            planExerciseId,
            ...values,
          })
          .onConflictDoNothing({ target: workoutSets.id })
          .returning({ id: workoutSets.id });
        // Nothing inserted: the id exists, in another gym (invisible to this transaction).
        if (!inserted[0]) throw new NotFoundException();
      } catch (e) {
        if (errorCode(e) === '23505') {
          throw new ConflictException('Another set already holds this position');
        }
        throw e;
      }
    });
  }

  private checkValues(measure: Measure, b: SetUpsert): void {
    const bad = (message: string) => new BadRequestException({ message });
    const has = (v: unknown) => v !== null && v !== undefined;
    if (measure === 'weight_reps') {
      if (!has(b.reps) || !has(b.weightKg) || has(b.durationSeconds)) {
        throw bad('This exercise is logged with reps and weight');
      }
    } else if (measure === 'reps') {
      if (!has(b.reps) || has(b.weightKg) || has(b.durationSeconds)) {
        throw bad('This exercise is logged with reps only');
      }
    } else if (!has(b.durationSeconds) || has(b.reps) || has(b.weightKg)) {
      throw bad('This exercise is logged with a duration');
    }
    if (b.done && has(b.reps) && b.reps === 0) throw bad('A done set needs at least one rep');
  }

  /** The plan exercise must belong to the session's plan and name the same exercise. */
  private async checkPlanExercise(
    tx: Tx,
    session: SessionRow,
    planExerciseId: string,
    exerciseId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ planId: planDays.planId, exerciseId: planExercises.exerciseId })
      .from(planExercises)
      .innerJoin(planDays, eq(planDays.id, planExercises.planDayId))
      .where(eq(planExercises.id, planExerciseId));
    // Gone since the phone queued the set (the trainer edited the plan): keep the set, drop the link.
    if (!row) return null;
    if (row.exerciseId !== exerciseId || !session.planId || row.planId !== session.planId) {
      throw new BadRequestException({ message: 'Unknown plan exercise' });
    }
    return planExerciseId;
  }

  private async ownSession(tx: Tx, memberId: string, sessionId: string): Promise<SessionRow> {
    const [session] = await tx
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));
    if (!session || session.memberId !== memberId) throw new NotFoundException();
    return session;
  }

  deleteSet(
    gymId: string,
    caller: Caller,
    memberId: string,
    sessionId: string,
    setId: string,
  ): Promise<void> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId, 'writeSessions');
      await tx.delete(workoutSets).where(
        and(
          eq(workoutSets.id, setId),
          eq(workoutSets.sessionId, sessionId),
          inArray(
            workoutSets.sessionId,
            tx
              .select({ id: workoutSessions.id })
              .from(workoutSessions)
              .where(
                and(eq(workoutSessions.id, sessionId), eq(workoutSessions.memberId, memberId)),
              ),
          ),
        ),
      );
    });
  }

  finish(
    gymId: string,
    caller: Caller,
    memberId: string,
    sessionId: string,
  ): Promise<WorkoutSession> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId, 'writeSessions');
      let session = await this.ownSession(tx, memberId, sessionId);
      if (!session.finishedAt) {
        const now = this.clock.now();
        const [updated] = await tx
          .update(workoutSessions)
          .set({
            finishedAt: now > session.startedAt ? now : session.startedAt,
            updatedAt: now,
          })
          .where(eq(workoutSessions.id, sessionId))
          .returning();
        session = updated ?? session;
      }
      return this.load(tx, session);
    });
  }

  list(
    gymId: string,
    caller: Caller,
    memberId: string,
    q: SessionListQuery,
  ): Promise<WorkoutSession[]> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId, 'read');
      const rows = await tx
        .select()
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.memberId, memberId),
            q.before ? lt(workoutSessions.startedAt, new Date(q.before)) : undefined,
          ),
        )
        .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.id))
        .limit(q.limit);
      const sets = rows.length
        ? await tx
            .select()
            .from(workoutSets)
            .where(
              inArray(
                workoutSets.sessionId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(workoutSets.setIndex))
        : [];
      const now = this.clock.now();
      return rows.map((r) =>
        toSession(
          r,
          sets.filter((s) => s.sessionId === r.id),
          now,
        ),
      );
    });
  }

  /** For each exercise the done sets of the member's most recent finished session containing it. */
  lastPerformance(
    gymId: string,
    caller: Caller,
    memberId: string,
    exerciseIds: string[],
  ): Promise<LastPerformance[]> {
    return withGym(gymId, async (tx) => {
      await this.access(tx, gymId, caller, memberId, 'read');
      const now = this.clock.now();
      const stale = new Date(now.getTime() - STALE_MS);
      const rows = await tx
        .select({ set: workoutSets, startedAt: workoutSessions.startedAt })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
        .where(
          and(
            eq(workoutSessions.memberId, memberId),
            inArray(workoutSets.exerciseId, exerciseIds),
            eq(workoutSets.done, true),
            or(
              sql`${workoutSessions.finishedAt} is not null`,
              lt(workoutSessions.startedAt, stale),
            ),
          ),
        )
        .orderBy(desc(workoutSessions.startedAt), asc(workoutSets.setIndex));
      const [gym] = await tx
        .select({ timezone: gyms.timezone })
        .from(gyms)
        .where(eq(gyms.id, gymId));
      const latest = new Map<string, { sessionId: string; startedAt: Date; sets: SetRow[] }>();
      for (const { set, startedAt } of rows) {
        const cur = latest.get(set.exerciseId);
        if (!cur) latest.set(set.exerciseId, { sessionId: set.sessionId, startedAt, sets: [set] });
        else if (cur.sessionId === set.sessionId) cur.sets.push(set);
      }
      return exerciseIds.flatMap((exerciseId) => {
        const l = latest.get(exerciseId);
        if (!l) return [];
        return [
          {
            exerciseId,
            sessionDate: todayIn(gym!.timezone, l.startedAt),
            sets: l.sets.map((s) => ({
              reps: s.reps,
              weightKg: s.weightKg === null ? null : Number(s.weightKg),
              durationSeconds: s.durationSeconds,
            })),
          },
        ];
      });
    });
  }
}
