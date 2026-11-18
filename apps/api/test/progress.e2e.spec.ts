import { randomUUID } from 'node:crypto';
import type {
  AttendancePoint,
  ExerciseProgress,
  ProgressExerciseOption,
  VolumePoint,
} from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { checkIns, trainerCovers, workoutSessions, workoutSets } from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('progress API: exercise progress, weekly volume, attendance', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('PR');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(workoutSets).where(eq(workoutSets.gymId, g));
      await systemDb.delete(workoutSessions).where(eq(workoutSessions.gymId, g));
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, g));
    }),
  );

  const bench = () => fx.exIds[0]!;
  const squat = () => fx.exIds[1]!;
  const clear = async () => {
    await systemDb.delete(workoutSets).where(eq(workoutSets.gymId, fx.gymId));
    await systemDb.delete(workoutSessions).where(eq(workoutSessions.gymId, fx.gymId));
    await systemDb.delete(checkIns).where(eq(checkIns.gymId, fx.gymId));
  };

  /** Logs one session through the API, as the member would. */
  async function log(
    who: string,
    startedAt: string,
    sets: { exerciseId: string; kg?: number; reps?: number; seconds?: number; done?: boolean }[],
  ): Promise<void> {
    const s = randomUUID();
    await fx.req('put', `/me/sessions/${s}`, who).send({ startedAt }).expect(200);
    const minute = (i: number) => new Date(Date.parse(startedAt) + (i + 1) * 60_000).toISOString();
    const counters = new Map<string, number>();
    for (const [i, x] of sets.entries()) {
      const idx = counters.get(x.exerciseId) ?? 0;
      counters.set(x.exerciseId, idx + 1);
      await fx
        .req('put', `/me/sessions/${s}/sets/${randomUUID()}`, who)
        .send({
          exerciseId: x.exerciseId,
          setIndex: idx,
          reps: x.reps,
          weightKg: x.kg,
          durationSeconds: x.seconds,
          done: x.done ?? true,
          loggedAt: minute(i),
        })
        .expect(200);
    }
    await fx.req('post', `/me/sessions/${s}/finish`, who).expect(200);
  }
  const get = async <T>(path: string, who = 'm', memberKey = 'm'): Promise<T> =>
    (await fx.req('get', `/members/${fx.id[memberKey]}${path}`, who).expect(200)).body as T;

  it('an exercise’s points are one per session: top set, and the best estimated one-rep max', async () => {
    await clear();
    await log('m', '2027-05-03T07:00:00.000Z', [
      { exerciseId: bench(), kg: 60, reps: 8 },
      { exerciseId: bench(), kg: 70, reps: 5 },
      { exerciseId: bench(), kg: 70, reps: 6 },
      { exerciseId: bench(), kg: 100, reps: 1, done: false }, // not done: ignored
    ]);
    await log('m', '2027-05-10T07:00:00.000Z', [
      { exerciseId: bench(), kg: 72.5, reps: 5 },
      { exerciseId: squat(), kg: 100, reps: 5 },
    ]);
    const res = await get<ExerciseProgress>(`/progress/exercises/${bench()}?weeks=8`);
    expect(res).toEqual({
      exerciseId: bench(),
      points: [
        { date: '2027-05-03', topSetKg: 70, topSetReps: 6, e1rmKg: 84 }, // 70 × 1.2 = 84
        { date: '2027-05-10', topSetKg: 72.5, topSetReps: 5, e1rmKg: 84.5 }, // 84.58 → 84.5
      ],
    });
    // the member sees the same through /me
    expect(
      (await fx.req('get', `/me/progress/exercises/${bench()}?weeks=8`, 'm').expect(200)).body,
    ).toEqual(res);
  });

  it('the weeks range cuts at the gym-local Monday, not at UTC', async () => {
    await clear();
    // weeks=4 from Wednesday 2027-05-12 starts on Monday 2027-04-19 (Athens).
    await log('m', '2027-04-18T20:00:00.000Z', [{ exerciseId: bench(), kg: 50, reps: 5 }]); // Sun 23:00 Athens
    await log('m', '2027-04-18T21:30:00.000Z', [{ exerciseId: bench(), kg: 60, reps: 5 }]); // Mon 00:30 Athens
    const four = await get<ExerciseProgress>(`/progress/exercises/${bench()}?weeks=4`);
    expect(four.points.map((p) => p.date)).toEqual(['2027-04-19']);
    const five = await get<ExerciseProgress>(`/progress/exercises/${bench()}?weeks=5`);
    expect(five.points.map((p) => p.date)).toEqual(['2027-04-18', '2027-04-19']);
  });

  it('lists the exercises with done weight and reps sets, most logged first', async () => {
    await clear();
    const pullUps = fx.exIds[2]!; // measure reps
    const plank = fx.exIds[4]!; // measure duration
    await log('m', '2027-05-03T07:00:00.000Z', [
      { exerciseId: bench(), kg: 60, reps: 8 },
      { exerciseId: bench(), kg: 60, reps: 8 }, // same session: counted once
      { exerciseId: pullUps, reps: 10 },
      { exerciseId: plank, seconds: 60 },
    ]);
    await log('m', '2027-05-10T07:00:00.000Z', [
      { exerciseId: bench(), kg: 62.5, reps: 5 },
      { exerciseId: squat(), kg: 100, reps: 5 },
      { exerciseId: squat(), kg: 100, reps: 5, done: false },
    ]);
    await log('m', '2027-05-11T07:00:00.000Z', [
      { exerciseId: squat(), kg: 100, reps: 5, done: false },
    ]);
    const list = await get<ProgressExerciseOption[]>('/progress/exercises');
    expect(list.map((o) => [o.exerciseId, o.sessions])).toEqual([
      [bench(), 2],
      [squat(), 1],
    ]);
    expect(list[0]).toMatchObject({ nameEn: 'Bench press' });
    expect(await get<ProgressExerciseOption[]>('/progress/exercises', 't')).toHaveLength(2);
  });

  it('weekly volume: 3×10 @ 50 + 2×5 @ 80 = 2300, a reps set and an undone set add nothing', async () => {
    await clear();
    await log('m', '2027-05-11T07:00:00.000Z', [
      ...[1, 2, 3].map(() => ({ exerciseId: bench(), kg: 50, reps: 10 })),
      ...[1, 2].map(() => ({ exerciseId: squat(), kg: 80, reps: 5 })),
      { exerciseId: fx.exIds[2]!, reps: 30 }, // pull-ups: a reps set
      { exerciseId: bench(), kg: 200, reps: 10, done: false },
    ]);
    const out = await get<VolumePoint[]>('/progress/volume?weeks=4');
    expect(out).toHaveLength(4);
    expect(out.at(-1)).toEqual({ weekStart: '2027-05-10', volumeKg: 2300 });
    expect(out.slice(0, 3).every((p) => p.volumeKg === 0)).toBe(true);
  });

  it('a set logged at 00:30 Athens on Monday 2027-03-29 counts in that Monday’s week', async () => {
    await clear();
    fx.clock.setDay('2027-03-31');
    await log('m', '2027-03-28T21:30:00.000Z', [{ exerciseId: bench(), kg: 50, reps: 10 }]);
    const out = await get<VolumePoint[]>('/progress/volume?weeks=4');
    expect(out.at(-1)).toEqual({ weekStart: '2027-03-29', volumeKg: 500 });
    expect(out.at(-2)!.volumeKg).toBe(0);
    fx.clock.setDay(DAY);
  });

  it('an exercise changed to duration later keeps its old sets; new duration sets add no volume', async () => {
    await clear();
    await log('m', '2027-05-11T07:00:00.000Z', [{ exerciseId: squat(), kg: 80, reps: 5 }]);
    await fx.req('patch', `/exercises/${squat()}`, 't').send({ measure: 'duration' }).expect(200);
    await log('m', '2027-05-12T07:00:00.000Z', [{ exerciseId: squat(), seconds: 90 }]);

    const volume = await get<VolumePoint[]>('/progress/volume?weeks=4');
    expect(volume.at(-1)).toEqual({ weekStart: '2027-05-10', volumeKg: 400 }); // only the old set
    const options = await get<ProgressExerciseOption[]>('/progress/exercises');
    expect(options.map((o) => [o.exerciseId, o.sessions])).toEqual([[squat(), 1]]);
    const progress = await get<ExerciseProgress>(`/progress/exercises/${squat()}?weeks=4`);
    expect(progress.points).toEqual([
      { date: '2027-05-11', topSetKg: 80, topSetReps: 5, e1rmKg: 93.5 }, // 80 × 1.1667 = 93.33 → 93.5
    ]);
    await fx
      .req('patch', `/exercises/${squat()}`, 't')
      .send({ measure: 'weight_reps' })
      .expect(200);
  });

  it('attendance counts distinct gym days with a valid check-in, not invalid ones', async () => {
    await clear();
    const row = (at: string, valid: boolean) => ({
      gymId: fx.gymId,
      memberId: fx.id.m!,
      at: new Date(at),
      method: 'manual' as const,
      valid,
      reason: valid ? null : 'no_membership',
    });
    await systemDb.insert(checkIns).values([
      row('2027-05-10T06:00:00Z', true), // Monday
      row('2027-05-10T17:00:00Z', true), // Monday again
      row('2027-05-12T06:00:00Z', true), // Wednesday
      row('2027-05-11T06:00:00Z', false), // invalid Tuesday
      row('2027-05-02T06:00:00Z', true), // the week before
    ]);
    const out = await get<AttendancePoint[]>('/progress/attendance?weeks=4');
    expect(out.at(-1)).toEqual({ weekStart: '2027-05-10', days: 2 });
    expect(out.at(-2)).toEqual({ weekStart: '2027-05-03', days: 0 });
    expect(out.at(-3)).toEqual({ weekStart: '2027-04-26', days: 1 });
  });

  it('attendance weeks and days follow the gym-local day, not UTC', async () => {
    await clear();
    await systemDb.insert(checkIns).values(
      [
        ['2027-05-09T20:00:00Z', true], // Sunday 23:00 Athens: the week before
        ['2027-05-09T21:30:00Z', true], // Monday 00:30 Athens: this week
        ['2027-05-10T20:30:00Z', true], // Monday 23:30 Athens, still Monday: same day as above
      ].map(([at, valid]) => ({
        gymId: fx.gymId,
        memberId: fx.id.m!,
        at: new Date(at as string),
        method: 'manual' as const,
        valid: valid as boolean,
        reason: null,
      })),
    );
    const out = await get<AttendancePoint[]>('/progress/attendance?weeks=4');
    expect(out.at(-1)).toEqual({ weekStart: '2027-05-10', days: 1 });
    expect(out.at(-2)).toEqual({ weekStart: '2027-05-03', days: 1 });
  });

  describe('who may reach it, and the range', () => {
    it('rejects weeks outside 4–104', async () => {
      for (const w of [3, 105, 'abc']) {
        await fx.req('get', `/me/progress/volume?weeks=${w}`, 'm').expect(400);
      }
      await fx.req('get', '/me/progress/volume?weeks=4', 'm').expect(200);
      await fx.req('get', '/me/progress/volume?weeks=104', 'm').expect(200);
      await fx.req('get', `/me/progress/exercises/not-a-uuid`, 'm').expect(400);
    });

    it('owner and reception get 404; a cover trainer reads today; the next day 404', async () => {
      for (const who of ['owner', 'rec']) {
        for (const p of ['/progress/exercises', '/progress/volume', '/progress/attendance']) {
          await fx.req('get', `/members/${fx.id.m}${p}`, who).expect(404);
        }
        await fx.req('get', `/members/${fx.id.m}/progress/exercises/${bench()}`, who).expect(404);
      }
      await systemDb
        .insert(trainerCovers)
        .values({ gymId: fx.gymId, memberId: fx.id.m!, trainerId: fx.id.u!, date: DAY });
      await fx.req('get', `/members/${fx.id.m}/progress/volume`, 'u').expect(200);
      await fx.req('get', `/members/${fx.id.m}/progress/attendance`, 'u').expect(200);
      fx.clock.setDay('2027-05-13');
      await fx.req('get', `/members/${fx.id.m}/progress/volume`, 'u').expect(404);
      fx.clock.setDay(DAY);
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, fx.gymId));
      await fx.req('get', `/members/${fx.id.m}/progress/volume`, 'n').expect(404);
      await fx.req('get', `/members/${fx.id.n}/progress/volume`, 't').expect(200);
    });

    it('another gym’s data never shows, even for the same exercise id', async () => {
      await fx
        .req('get', `/me/progress/exercises/${bench()}`, 'stranger', fx.otherGymId)
        .expect(200)
        .expect((r) => expect(r.body).toEqual({ exerciseId: bench(), points: [] }));
      const other = (
        await fx.req('get', '/me/progress/exercises', 'stranger', fx.otherGymId).expect(200)
      ).body as unknown[];
      expect(other).toEqual([]);
    });
  });
});
