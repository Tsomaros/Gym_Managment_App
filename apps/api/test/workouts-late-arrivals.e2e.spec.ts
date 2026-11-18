import { randomUUID } from 'node:crypto';
import type { WorkoutSession } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { workoutSessions, workoutSets } from '../src/db/schema';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** Operations of the offline queue that arrive late or out of order (two tabs, a slow retry). */
describe('workout writes that arrive late', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('WL');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(workoutSets).where(eq(workoutSets.gymId, g));
      await systemDb.delete(workoutSessions).where(eq(workoutSessions.gymId, g));
    }),
  );

  const bench = () => fx.exIds[0]!;
  const mine = async () =>
    (await fx.req('get', '/me/sessions', 'm').expect(200)).body as WorkoutSession[];
  const body = (reps: number, loggedAt: string, over: object = {}) => ({
    exerciseId: bench(),
    setIndex: 0,
    reps,
    weightKg: 50,
    done: true,
    loggedAt,
    ...over,
  });

  it('an older copy of a set arriving after a newer one does not undo the newer values', async () => {
    const s = randomUUID();
    const sid = randomUUID();
    await fx
      .req('put', `/me/sessions/${s}`, 'm')
      .send({ startedAt: '2027-05-12T08:00:00.000Z' })
      .expect(200);
    await fx
      .req('put', `/me/sessions/${s}/sets/${sid}`, 'm')
      .send(body(8, '2027-05-12T08:05:00.000Z'))
      .expect(200);
    // the member corrected it to 12 reps a minute later
    await fx
      .req('put', `/me/sessions/${s}/sets/${sid}`, 'm')
      .send(body(12, '2027-05-12T08:06:00.000Z'))
      .expect(200);
    // a slow second tab now delivers the first version
    await fx
      .req('put', `/me/sessions/${s}/sets/${sid}`, 'm')
      .send(body(8, '2027-05-12T08:05:00.000Z'))
      .expect(200);
    const [session] = await mine();
    expect(session!.sets).toHaveLength(1);
    expect(session!.sets[0]).toMatchObject({ reps: 12, loggedAt: '2027-05-12T08:06:00.000Z' });
  });

  it('an equal copy is still a harmless update, and a newer one wins', async () => {
    const s = randomUUID();
    const sid = randomUUID();
    await fx
      .req('put', `/me/sessions/${s}`, 'm')
      .send({ startedAt: '2027-05-12T09:00:00.000Z' })
      .expect(200);
    for (const [reps, at] of [
      [5, '2027-05-12T09:05:00.000Z'],
      [5, '2027-05-12T09:05:00.000Z'],
      [6, '2027-05-12T09:07:00.000Z'],
    ] as const) {
      await fx.req('put', `/me/sessions/${s}/sets/${sid}`, 'm').send(body(reps, at)).expect(200);
    }
    const found = (await mine()).find((x) => x.id === s)!;
    expect(found.sets[0]).toMatchObject({ reps: 6 });
  });

  it('a set of an exercise archived while the phone was offline is still stored', async () => {
    const s = randomUUID();
    await fx
      .req('put', `/me/sessions/${s}`, 'm')
      .send({ startedAt: '2027-05-12T10:00:00.000Z' })
      .expect(200);
    await fx.req('post', `/exercises/${fx.exIds[3]}/archive`, 'owner').expect(204);
    const sid = randomUUID();
    await fx
      .req('put', `/me/sessions/${s}/sets/${sid}`, 'm')
      .send(body(5, '2027-05-12T10:05:00.000Z', { exerciseId: fx.exIds[3] }))
      .expect(200);
    const found = (await mine()).find((x) => x.id === s)!;
    expect(found.sets.map((x) => x.id)).toEqual([sid]);
  });
});
