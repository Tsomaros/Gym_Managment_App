import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AttendancePoint,
  ExerciseProgress,
  GymRole,
  ProgressExerciseOption,
  VolumePoint,
} from '@gym/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { checkIns, exercises, gyms, workoutSessions, workoutSets } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { addDays, todayIn } from '../memberships/dates';
import { healthAccess } from '../workouts/health-access';
import { e1rm, lastWeeks, topSet, weeklyAttendance, weeklyVolume } from './progress-math';

export interface Caller {
  userId: string;
  roles: GymRole[];
}

@Injectable()
export class ProgressService {
  constructor(private readonly clock: Clock) {}

  /** Runs `fn` for a caller who may read the member's data (else 404), with the gym's clock. */
  private run<T>(
    gymId: string,
    caller: Caller,
    memberId: string,
    fn: (ctx: { tx: Tx; timezone: string; today: string }) => Promise<T>,
  ): Promise<T> {
    return withGym(gymId, async (tx) => {
      const [gym] = await tx
        .select({ timezone: gyms.timezone })
        .from(gyms)
        .where(eq(gyms.id, gymId));
      const today = todayIn(gym!.timezone, this.clock.now());
      const access = await healthAccess(tx, gymId, caller, memberId, today);
      if (!access.read) throw new NotFoundException();
      return fn({ tx, timezone: gym!.timezone, today });
    });
  }

  /** A UTC instant safely before the gym-local start of the first week (zones are within ±14 h). */
  private since(firstWeek: string): Date {
    return new Date(`${addDays(firstWeek, -1)}T00:00:00Z`);
  }

  exerciseOptions(
    gymId: string,
    caller: Caller,
    memberId: string,
  ): Promise<ProgressExerciseOption[]> {
    return this.run(gymId, caller, memberId, async ({ tx }) => {
      const rows = await tx
        .select({
          exerciseId: workoutSets.exerciseId,
          nameEl: exercises.nameEl,
          nameEn: exercises.nameEn,
          sessions: sql<number>`count(distinct ${workoutSets.sessionId})::int`,
        })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
        .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
        .where(
          and(
            eq(workoutSessions.memberId, memberId),
            eq(workoutSets.done, true),
            eq(workoutSets.measure, 'weight_reps'),
          ),
        )
        .groupBy(workoutSets.exerciseId, exercises.nameEl, exercises.nameEn);
      return rows.sort((a, b) => b.sessions - a.sessions || a.nameEl.localeCompare(b.nameEl, 'el'));
    });
  }

  exerciseProgress(
    gymId: string,
    caller: Caller,
    memberId: string,
    exerciseId: string,
    weeks: number,
  ): Promise<ExerciseProgress> {
    return this.run(gymId, caller, memberId, async ({ tx, timezone, today }) => {
      const first = lastWeeks(today, weeks)[0]!;
      const rows = await tx
        .select({
          sessionId: workoutSets.sessionId,
          startedAt: workoutSessions.startedAt,
          reps: workoutSets.reps,
          weightKg: workoutSets.weightKg,
        })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
        .where(
          and(
            eq(workoutSessions.memberId, memberId),
            eq(workoutSets.exerciseId, exerciseId),
            eq(workoutSets.done, true),
            eq(workoutSets.measure, 'weight_reps'),
            gte(workoutSessions.startedAt, this.since(first)),
          ),
        );
      const sessions = new Map<
        string,
        { startedAt: Date; sets: { weightKg: number; reps: number }[] }
      >();
      for (const r of rows) {
        if (r.reps === null || r.weightKg === null) continue;
        const s = sessions.get(r.sessionId) ?? { startedAt: r.startedAt, sets: [] };
        s.sets.push({ weightKg: Number(r.weightKg), reps: r.reps });
        sessions.set(r.sessionId, s);
      }
      const points = [...sessions.values()]
        .map((s) => ({
          date: todayIn(timezone, s.startedAt),
          startedAt: s.startedAt,
          sets: s.sets,
        }))
        .filter((s) => s.date >= first)
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
        .map((s) => {
          const top = topSet(s.sets)!;
          const best = s.sets
            .map((x) => e1rm(x.weightKg, x.reps))
            .filter((v): v is number => v !== null);
          return {
            date: s.date,
            topSetKg: top.weightKg,
            topSetReps: top.reps,
            e1rmKg: best.length ? Math.max(...best) : null,
          };
        });
      return { exerciseId, points };
    });
  }

  volume(gymId: string, caller: Caller, memberId: string, weeks: number): Promise<VolumePoint[]> {
    return this.run(gymId, caller, memberId, async ({ tx, timezone, today }) => {
      const list = lastWeeks(today, weeks);
      const rows = await tx
        .select({
          measure: workoutSets.measure,
          done: workoutSets.done,
          reps: workoutSets.reps,
          weightKg: workoutSets.weightKg,
          loggedAt: workoutSets.loggedAt,
        })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
        .where(
          and(
            eq(workoutSessions.memberId, memberId),
            eq(workoutSets.done, true),
            gte(workoutSets.loggedAt, this.since(list[0]!)),
          ),
        );
      return weeklyVolume(
        rows.map((r) => ({
          measure: r.measure as 'weight_reps' | 'reps' | 'duration',
          done: r.done,
          reps: r.reps,
          weightKg: r.weightKg === null ? null : Number(r.weightKg),
          localDate: todayIn(timezone, r.loggedAt),
        })),
        list,
      );
    });
  }

  attendance(
    gymId: string,
    caller: Caller,
    memberId: string,
    weeks: number,
  ): Promise<AttendancePoint[]> {
    return this.run(gymId, caller, memberId, async ({ tx, timezone, today }) => {
      const list = lastWeeks(today, weeks);
      const rows = await tx
        .select({ at: checkIns.at })
        .from(checkIns)
        .where(
          and(
            eq(checkIns.memberId, memberId),
            eq(checkIns.valid, true),
            gte(checkIns.at, this.since(list[0]!)),
          ),
        );
      return weeklyAttendance(
        rows.map((r) => todayIn(timezone, r.at)),
        list,
      );
    });
  }
}
