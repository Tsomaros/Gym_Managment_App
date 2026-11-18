import { randomUUID } from 'node:crypto';
import type { Plan, WorkoutSession } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { workoutSessions, workoutSets } from '../src/db/schema';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** Replays the offline queue can produce: odd clocks, plans edited meanwhile, retries in flight. */
describe('workout replays', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('WR');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(workoutSets).where(eq(workoutSets.gymId, g));
      await systemDb.delete(workoutSessions).where(eq(workoutSessions.gymId, g));
    }),
  );

  const bench = () => fx.exIds[0]!;
  const squat = () => fx.exIds[1]!;
  const set = (over: object = {}) => ({
    exerciseId: bench(),
    setIndex: 0,
    reps: 5,
    weightKg: 50,
    done: true,
    loggedAt: '2027-05-12T08:05:00.000Z',
    ...over,
  });
  const mine = async () =>
    (await fx.req('get', '/me/sessions', 'm').expect(200)).body as WorkoutSession[];

  it('a set logged before its session started (a wrong phone clock) never blocks the next session', async () => {
    const a = randomUUID();
    await fx
      .req('put', `/me/sessions/${a}`, 'm')
      .send({ startedAt: '2027-05-12T08:00:00.000Z' })
      .expect(200);
    await fx
      .req('put', `/me/sessions/${a}/sets/${randomUUID()}`, 'm')
      .send(set({ loggedAt: '2027-05-12T07:00:00.000Z' }))
      .expect(200);
    const b = randomUUID();
    await fx
      .req('put', `/me/sessions/${b}`, 'm')
      .send({ startedAt: '2027-05-12T09:00:00.000Z' })
      .expect(200);
    const list = await mine();
    expect(list.find((s) => s.id === a)!.finishedAt).toBe('2027-05-12T08:00:00.000Z');
    expect(list.find((s) => s.id === b)!.finishedAt).toBeNull();
  });

  it('replaying a session whose plan day the trainer has since removed is a harmless 200', async () => {
    const plan = (
      await fx
        .req('post', `/members/${fx.id.m}/plans`, 't')
        .send({
          title: 'Πλάνο',
          days: [
            { title: 'Α', exercises: [{ exerciseId: bench(), sets: 3, toFailure: true }] },
            { title: 'Β', exercises: [{ exerciseId: squat(), sets: 3, toFailure: true }] },
          ],
        })
        .expect(201)
    ).body as Plan;
    const [dayA, dayB] = plan.days as [Plan['days'][0], Plan['days'][0]];
    const s = randomUUID();
    const body = { startedAt: '2027-05-12T10:00:00.000Z', planId: plan.id, planDayId: dayA.id };
    await fx.req('put', `/me/sessions/${s}`, 'm').send(body).expect(200);
    // the trainer drops day A from the plan
    await fx
      .req('put', `/plans/${plan.id}`, 't')
      .send({
        title: plan.title,
        days: [
          {
            id: dayB.id,
            title: dayB.title,
            exercises: dayB.exercises.map((e) => ({
              id: e.id,
              exerciseId: e.exerciseId,
              sets: e.sets,
              toFailure: e.toFailure,
            })),
          },
        ],
      })
      .expect(200);
    const replay = await fx.req('put', `/me/sessions/${s}`, 'm').send(body).expect(200);
    expect(replay.body).toMatchObject({ id: s, planId: plan.id, planDayId: null });
  });

  it('the same new set sent twice at once succeeds both times and is stored once', async () => {
    const s = randomUUID();
    await fx
      .req('put', `/me/sessions/${s}`, 'm')
      .send({ startedAt: '2027-05-12T11:00:00.000Z' })
      .expect(200);
    const sid = randomUUID();
    const send = () =>
      fx
        .req('put', `/me/sessions/${s}/sets/${sid}`, 'm')
        .send(set({ loggedAt: '2027-05-12T11:05:00.000Z' }));
    const results = await Promise.all(Array.from({ length: 4 }, () => send()));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const session = (await mine()).find((x) => x.id === s)!;
    expect(session.sets).toHaveLength(1);
  });
});
