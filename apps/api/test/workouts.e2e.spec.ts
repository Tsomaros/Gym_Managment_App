import { randomUUID } from 'node:crypto';
import type { Exercise, LastPerformance, Plan, WorkoutSession } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { trainerCovers, workoutSessions, workoutSets } from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('workout sessions and sets: client ids, idempotent replays, access', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('WO');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(workoutSets).where(eq(workoutSets.gymId, g));
      await systemDb.delete(workoutSessions).where(eq(workoutSessions.gymId, g));
    }),
  );

  const at = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;
  const bench = () => fx.exIds[0]!; // weight_reps
  const squat = () => fx.exIds[1]!; // weight_reps
  const plank = () => fx.exIds[4]!; // duration

  const putSession = (who: string, sessionId: string, body: object = {}, memberKey = 'm') =>
    fx.req('put', `/members/${fx.id[memberKey]}/sessions/${sessionId}`, who).send({
      startedAt: at('08:00'),
      ...body,
    });
  const putMine = (who: string, sessionId: string, body: object = {}) =>
    fx.req('put', `/me/sessions/${sessionId}`, who).send({ startedAt: at('08:00'), ...body });
  const setBody = (over: object = {}) => ({
    exerciseId: bench(),
    setIndex: 0,
    reps: 10,
    weightKg: 50,
    done: true,
    loggedAt: at('08:05'),
    ...over,
  });
  const putSet = (who: string, sessionId: string, setId: string, body: object) =>
    fx.req('put', `/me/sessions/${sessionId}/sets/${setId}`, who).send(body);
  const mine = async (who = 'm') =>
    (await fx.req('get', '/me/sessions', who).expect(200)).body as WorkoutSession[];
  const clearSessions = async () => {
    await systemDb.delete(workoutSets).where(eq(workoutSets.gymId, fx.gymId));
    await systemDb.delete(workoutSessions).where(eq(workoutSessions.gymId, fx.gymId));
  };

  it('three sets put twice leave exactly three sets in order, with unchanged bodies', async () => {
    await clearSessions();
    const s = randomUUID();
    const setIds = [randomUUID(), randomUUID(), randomUUID()];
    const replay = async () => {
      await putMine('m', s).expect(200);
      // sent out of order on purpose: the server orders by exercise and set index
      for (const [i, sid] of [...setIds.entries()].reverse()) {
        await putSet(
          'm',
          s,
          sid,
          setBody({ setIndex: i, reps: 10 - i, loggedAt: at(`08:0${5 + i}`) }),
        ).expect(200);
      }
    };
    await replay();
    const first = await mine();
    await replay();
    const second = await mine();
    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
    expect(second[0]!.sets.map((x) => [x.setIndex, x.reps, x.id])).toEqual([
      [0, 10, setIds[0]],
      [1, 9, setIds[1]],
      [2, 8, setIds[2]],
    ]);
    expect(second[0]!.sets[0]).toMatchObject({ measure: 'weight_reps', weightKg: 50, done: true });
    // the trainer sees the same list
    const asTrainer = (await fx.req('get', `/members/${fx.id.m}/sessions`, 't').expect(200))
      .body as WorkoutSession[];
    expect(asTrainer).toEqual(second);
  });

  it('opening a new session closes the open one at its last set; a replay of the old one changes nothing', async () => {
    await clearSessions();
    const s1 = randomUUID();
    const s2 = randomUUID();
    await putMine('m', s1).expect(200);
    await putSet('m', s1, randomUUID(), setBody({ loggedAt: at('08:20') })).expect(200);
    await putSet('m', s1, randomUUID(), setBody({ setIndex: 1, loggedAt: at('08:30') })).expect(
      200,
    );
    await putMine('m', s2, { startedAt: at('09:00') }).expect(200);
    let list = await mine();
    expect(list.find((x) => x.id === s1)!.finishedAt).toBe(at('08:30'));
    expect(list.find((x) => x.id === s2)!.finishedAt).toBeNull();
    // the phone replays S1 later: S1 stays closed and S2 stays open
    await putMine('m', s1).expect(200);
    list = await mine();
    expect(list.find((x) => x.id === s1)!.finishedAt).toBe(at('08:30'));
    expect(list.find((x) => x.id === s2)!.finishedAt).toBeNull();
    // a session with no sets closes at its own start
    const s3 = randomUUID();
    await putMine('m', s3, { startedAt: at('09:10') }).expect(200);
    list = await mine();
    expect(list.find((x) => x.id === s2)!.finishedAt).toBe(at('09:00'));
  });

  it('the same set sent twice at once (two tabs, or a retry after a timeout) is stored once', async () => {
    await clearSessions();
    const s = randomUUID();
    const sid = randomUUID();
    await putMine('m', s).expect(200);
    // several copies, so the race between two first inserts of the same id really happens
    await Promise.all(Array.from({ length: 6 }, () => putSet('m', s, sid, setBody()).expect(200)));
    const sets = (await mine())[0]!.sets;
    expect(sets.map((x) => x.id)).toEqual([sid]);
    // the same session sent twice at once is one session
    const s2 = randomUUID();
    await Promise.all([putMine('m', s2).expect(200), putMine('m', s2).expect(200)]);
    expect((await mine()).filter((x) => x.id === s2)).toHaveLength(1);
  });

  it('an old session arriving after a newer one is closed at once and leaves the newer one open', async () => {
    await clearSessions();
    const newer = randomUUID();
    const older = randomUUID();
    await putMine('m', newer, { startedAt: at('09:00') }).expect(200);
    const res = await putMine('m', older, { startedAt: at('07:00') }).expect(200);
    expect(res.body.finishedAt).toBe(at('07:00'));
    const list = await mine();
    expect(list.find((x) => x.id === newer)!.finishedAt).toBeNull();
    expect(list.find((x) => x.id === older)!.finishedAt).toBe(at('07:00'));
  });

  it('a malformed id in the path is a 400, not a server error', async () => {
    await fx.req('put', '/me/sessions/not-a-uuid', 'm').send({ startedAt: at('08:00') }).expect(400);
    await fx.req('get', '/members/not-a-uuid/sessions', 't').expect(400);
    await fx.req('put', `/me/sessions/${randomUUID()}/sets/x`, 'm').send(setBody()).expect(400);
    await fx.req('delete', `/me/sessions/${randomUUID()}/sets/x`, 'm').expect(400);
    await fx.req('post', '/me/sessions/x/finish', 'm').expect(400);
  });

  it('two new sessions opened at the same moment leave exactly one open', async () => {
    await clearSessions();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await Promise.all(
      ids.map((s, i) => putMine('m', s, { startedAt: at(`08:0${i}`) }).expect(200)),
    );
    const open = (await mine()).filter((x) => x.finishedAt === null);
    expect(open).toHaveLength(1);
    // the latest start (08:02) is the one that stays open
    expect(open[0]!.id).toBe(ids[2]);
  });

  it('finish closes the session; late sets from the offline queue are still accepted', async () => {
    await clearSessions();
    const s = randomUUID();
    await putMine('m', s).expect(200);
    await putSet('m', s, randomUUID(), setBody()).expect(200);
    const done = await fx.req('post', `/me/sessions/${s}/finish`, 'm').expect(200);
    expect(done.body.finishedAt).not.toBeNull();
    const firstFinish = done.body.finishedAt;
    // an hour later a second finish must not move the first one (the clock is fixed otherwise)
    fx.clock.current = new Date(`${DAY}T10:00:00Z`);
    const again = await fx.req('post', `/me/sessions/${s}/finish`, 'm').expect(200); // idempotent
    expect(again.body.finishedAt).toBe(firstFinish);
    fx.clock.setDay(DAY);
    // a replay of the session body does not reopen it
    await putMine('m', s).expect(200);
    await putSet('m', s, randomUUID(), setBody({ setIndex: 1, loggedAt: at('08:40') })).expect(200);
    const [only] = await mine();
    expect(only!.finishedAt).toBe(firstFinish);
    expect(only!.sets).toHaveLength(2);
  });

  it('a session open for more than 12 hours is shown finished at its last set', async () => {
    await clearSessions();
    const stale = randomUUID();
    await putMine('m', stale, { startedAt: '2027-05-11T18:00:00.000Z' }).expect(200);
    const empty = (await mine())[0]!;
    expect(empty.finishedAt).toBe('2027-05-11T18:00:00.000Z');
    await putSet(
      'm',
      stale,
      randomUUID(),
      setBody({ loggedAt: '2027-05-11T18:30:00.000Z' }),
    ).expect(200);
    expect((await mine())[0]!.finishedAt).toBe('2027-05-11T18:30:00.000Z');
  });

  it('rejects sets without the values their exercise needs, and weights off the 0.25 grid', async () => {
    await clearSessions();
    const s = randomUUID();
    await putMine('m', s).expect(200);
    const id = () => randomUUID();
    await putSet('m', s, id(), setBody({ weightKg: undefined })).expect(400);
    await putSet('m', s, id(), setBody({ reps: undefined })).expect(400);
    await putSet('m', s, id(), setBody({ weightKg: 20.3 })).expect(400);
    await putSet('m', s, id(), setBody({ weightKg: 1000 })).expect(400);
    await putSet('m', s, id(), setBody({ reps: 101 })).expect(400);
    // a duration exercise needs seconds and takes no reps or weight
    await putSet(
      'm',
      s,
      id(),
      setBody({ exerciseId: plank(), reps: undefined, weightKg: undefined }),
    ).expect(400);
    await putSet('m', s, id(), setBody({ exerciseId: plank(), durationSeconds: 60 })).expect(400);
    await putSet(
      'm',
      s,
      id(),
      setBody({ exerciseId: plank(), durationSeconds: 7201, reps: undefined, weightKg: undefined }),
    ).expect(400);
    await putSet(
      'm',
      s,
      id(),
      setBody({ exerciseId: plank(), durationSeconds: 60, reps: undefined, weightKg: undefined }),
    ).expect(200);
    await putSet('m', s, id(), setBody({ exerciseId: randomUUID() })).expect(404);
    expect((await mine())[0]!.sets).toHaveLength(1);
  });

  it('the same set id sent with another exercise or session is refused, not moved', async () => {
    await clearSessions();
    const s1 = randomUUID();
    const s2 = randomUUID();
    const sid = randomUUID();
    await putMine('m', s1).expect(200);
    await putSet('m', s1, sid, setBody()).expect(200);
    await putMine('m', s2, { startedAt: at('09:00') }).expect(200);
    await putSet('m', s2, sid, setBody()).expect(404);
    // an update of the stored set (same exercise) changes its values, never its measure
    await putSet('m', s1, sid, setBody({ reps: 12 })).expect(200);
    await putSet('m', s1, sid, setBody({ exerciseId: squat() })).expect(409);
    const list = await mine();
    expect(list.find((x) => x.id === s1)!.sets[0]).toMatchObject({ reps: 12, exerciseId: bench() });
  });

  it('a set keeps its exercise when the trainer removes the plan exercise it pointed at', async () => {
    await clearSessions();
    const planBody = {
      title: 'Πάνω σώμα',
      days: [
        {
          title: 'Ημέρα Α',
          exercises: [
            { exerciseId: bench(), sets: 3, repsMin: 8, repsMax: 10, toFailure: false },
            { exerciseId: squat(), sets: 3, repsMin: 8, repsMax: 10, toFailure: false },
          ],
        },
      ],
      activate: true,
    };
    const plan = (await fx.req('post', `/members/${fx.id.m}/plans`, 't').send(planBody).expect(201))
      .body as Plan;
    const day = plan.days[0]!;
    const [pe1, pe2] = day.exercises as [(typeof day.exercises)[0], (typeof day.exercises)[0]];
    const s = randomUUID();
    await putMine('m', s, { planId: plan.id, planDayId: day.id }).expect(200);
    await putSet('m', s, randomUUID(), setBody({ planExerciseId: pe1.id })).expect(200);
    await putSet(
      'm',
      s,
      randomUUID(),
      setBody({ exerciseId: squat(), planExerciseId: pe2.id }),
    ).expect(200);
    // a plan exercise whose exercise differs from the set's is refused
    await putSet('m', s, randomUUID(), setBody({ setIndex: 5, planExerciseId: pe2.id })).expect(
      400,
    );

    const put = {
      title: plan.title,
      days: [
        {
          id: day.id,
          title: day.title,
          exercises: [
            { id: pe2.id, exerciseId: squat(), sets: 3, repsMin: 8, repsMax: 10, toFailure: false },
          ],
        },
      ],
    };
    await fx.req('put', `/plans/${plan.id}`, 't').send(put).expect(200);
    const [session] = await mine();
    const byExercise = Object.fromEntries(session!.sets.map((x) => [x.exerciseId, x]));
    expect(byExercise[bench()]).toMatchObject({ planExerciseId: null, reps: 10 });
    expect(byExercise[squat()]!.planExerciseId).toBe(pe2.id);
    expect(session!.planId).toBe(plan.id);
  });

  it('a plan or plan day that is not the member’s own is refused', async () => {
    await clearSessions();
    const mkPlan = async (member: string) =>
      (
        await fx
          .req('post', `/members/${fx.id[member]}/plans`, 't')
          .send({
            title: 'Πλάνο',
            days: [{ title: 'Α', exercises: [{ exerciseId: bench(), sets: 3, toFailure: true }] }],
          })
          .expect(201)
      ).body as Plan;
    const mPlan = await mkPlan('m');
    const nPlan = await mkPlan('n');
    await putSession('n', randomUUID(), { planId: mPlan.id }, 'n').expect(400);
    await putMine('n', randomUUID(), { planId: randomUUID() }).expect(400);
    await putMine('n', randomUUID(), { planDayId: mPlan.days[0]!.id }).expect(400);
    // a day of the member's plan paired with another plan's id
    await putMine('m', randomUUID(), { planId: nPlan.id, planDayId: mPlan.days[0]!.id }).expect(
      400,
    );
    await putMine('m', randomUUID(), { planId: mPlan.id, planDayId: mPlan.days[0]!.id }).expect(
      200,
    );
  });

  it('last-performance returns the latest finished session’s done sets for each exercise', async () => {
    await clearSessions();
    const old = randomUUID();
    const recent = randomUUID();
    const open = randomUUID();
    await putMine('m', old, {
      startedAt: at('06:00', '2027-05-10'),
      finishedAt: at('07:00', '2027-05-10'),
    }).expect(200);
    await putSet(
      'm',
      old,
      randomUUID(),
      setBody({ weightKg: 40, loggedAt: at('06:10', '2027-05-10') }),
    ).expect(200);
    await putMine('m', recent, {
      startedAt: at('06:00', '2027-05-11'),
      finishedAt: at('07:00', '2027-05-11'),
    }).expect(200);
    await putSet(
      'm',
      recent,
      randomUUID(),
      setBody({ weightKg: 50, loggedAt: at('06:10', '2027-05-11') }),
    ).expect(200);
    await putSet(
      'm',
      recent,
      randomUUID(),
      setBody({ setIndex: 1, weightKg: 52.5, reps: 8, loggedAt: at('06:20', '2027-05-11') }),
    ).expect(200);
    await putSet(
      'm',
      recent,
      randomUUID(),
      setBody({ setIndex: 2, weightKg: 99, loggedAt: at('06:30', '2027-05-11'), done: false }),
    ).expect(200);
    await putMine('m', open, { startedAt: at('08:00') }).expect(200);
    await putSet('m', open, randomUUID(), setBody({ weightKg: 70 })).expect(200);

    const res = (
      await fx.req('get', `/me/last-performance?exerciseIds=${bench()},${squat()}`, 'm').expect(200)
    ).body as LastPerformance[];
    expect(res).toEqual([
      {
        exerciseId: bench(),
        sessionDate: '2027-05-11',
        sets: [
          { reps: 10, weightKg: 50, durationSeconds: null },
          { reps: 8, weightKg: 52.5, durationSeconds: null },
        ],
      },
    ]);
    await fx
      .req('get', `/members/${fx.id.m}/last-performance?exerciseIds=${bench()}`, 't')
      .expect(200);
    await fx.req('get', '/me/last-performance?exerciseIds=nope', 'm').expect(400);
  });

  it('last-performance dates the session in the gym’s timezone and counts a stale open session', async () => {
    await clearSessions();
    // 22:30Z on the 11th is 01:30 on the 12th in Athens (UTC+3 in May)
    const late = randomUUID();
    await putMine('m', late, {
      startedAt: at('22:30', '2027-05-11'),
      finishedAt: at('23:30', '2027-05-11'),
    }).expect(200);
    await putSet(
      'm',
      late,
      randomUUID(),
      setBody({ exerciseId: squat(), weightKg: 80, loggedAt: at('22:40', '2027-05-11') }),
    ).expect(200);
    // never finished and started 15 h before the clock (09:00Z): counts as finished
    const stale = randomUUID();
    await putMine('m', stale, { startedAt: at('18:00', '2027-05-11') }).expect(200);
    await putSet(
      'm',
      stale,
      randomUUID(),
      setBody({ weightKg: 60, loggedAt: at('18:10', '2027-05-11') }),
    ).expect(200);
    const res = (
      await fx.req('get', `/me/last-performance?exerciseIds=${bench()},${squat()}`, 'm').expect(200)
    ).body as LastPerformance[];
    expect(res).toEqual([
      {
        exerciseId: bench(),
        sessionDate: '2027-05-11', // 18:00Z is 21:00 Athens, still the 11th
        sets: [{ reps: 10, weightKg: 60, durationSeconds: null }],
      },
      {
        exerciseId: squat(),
        sessionDate: '2027-05-12',
        sets: [{ reps: 10, weightKg: 80, durationSeconds: null }],
      },
    ]);
  });

  it('lists newest first with a before cursor and limit', async () => {
    await clearSessions();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, s] of ids.entries()) {
      await putMine('m', s, {
        startedAt: at(`0${i + 1}:00`, '2027-05-10'),
        finishedAt: at(`0${i + 1}:30`, '2027-05-10'),
      }).expect(200);
    }
    const page = (await fx.req('get', '/me/sessions?limit=2', 'm').expect(200))
      .body as WorkoutSession[];
    expect(page.map((x) => x.id)).toEqual([ids[2], ids[1]]);
    const next = (
      await fx
        .req('get', `/me/sessions?limit=2&before=${encodeURIComponent(page[1]!.startedAt)}`, 'm')
        .expect(200)
    ).body as WorkoutSession[];
    expect(next.map((x) => x.id)).toEqual([ids[0]]);
  });

  describe('who may reach it', () => {
    it('the primary trainer reads but cannot write; the owner and reception get 404', async () => {
      await clearSessions();
      const s = randomUUID();
      await putMine('m', s).expect(200);
      await putSet('m', s, randomUUID(), setBody()).expect(200);
      await fx.req('get', `/members/${fx.id.m}/sessions`, 't').expect(200);
      await putSession('t', s).expect(403);
      await fx
        .req('put', `/members/${fx.id.m}/sessions/${s}/sets/${randomUUID()}`, 't')
        .send(setBody())
        .expect(403);
      await fx.req('post', `/members/${fx.id.m}/sessions/${s}/finish`, 't').expect(403);
      for (const who of ['owner', 'rec']) {
        await fx.req('get', `/members/${fx.id.m}/sessions`, who).expect(404);
        await fx
          .req('get', `/members/${fx.id.m}/last-performance?exerciseIds=${bench()}`, who)
          .expect(404);
        await putSession(who, randomUUID()).expect(404);
      }
    });

    it('a cover trainer reads today, gets 403 on writes, and 404 the next day', async () => {
      await systemDb
        .insert(trainerCovers)
        .values({ gymId: fx.gymId, memberId: fx.id.m!, trainerId: fx.id.u!, date: DAY });
      await fx.req('get', `/members/${fx.id.m}/sessions`, 'u').expect(200);
      await putSession('u', randomUUID()).expect(403);
      fx.clock.setDay('2027-05-13');
      await fx.req('get', `/members/${fx.id.m}/sessions`, 'u').expect(404);
      await putSession('u', randomUUID()).expect(404);
      fx.clock.setDay(DAY);
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, fx.gymId));
    });

    it('another member and a trainer who is not theirs reach nothing; a trainer cannot use /me', async () => {
      await fx.req('get', `/members/${fx.id.m}/sessions`, 'n').expect(404);
      await fx.req('get', `/members/${fx.id.m}/sessions`, 'u').expect(404);
      await putSession('n', randomUUID(), {}, 'm').expect(404);
      await fx.req('get', '/me/sessions', 't').expect(404);
    });

    it('a session or set id that belongs to another member is a 404, never an overwrite', async () => {
      await clearSessions();
      const s = randomUUID();
      const sid = randomUUID();
      await putMine('m', s).expect(200);
      await putSet('m', s, sid, setBody()).expect(200);
      await putMine('n', s).expect(404); // m's session id
      await putSet('n', s, randomUUID(), setBody()).expect(404); // a set into m's session
      const ns = randomUUID();
      await putMine('n', ns).expect(200);
      await putSet('n', ns, sid, setBody()).expect(404); // m's set id
      await fx.req('delete', `/me/sessions/${s}/sets/${sid}`, 'n').expect(204); // not n's: nothing happens
      expect((await mine('m'))[0]!.sets).toHaveLength(1);
    });

    it('two gyms: ids never cross, and a colliding id is a 404 rather than a server error', async () => {
      await clearSessions();
      const s = randomUUID();
      const sid = randomUUID();
      await putMine('m', s).expect(200);
      await putSet('m', s, sid, setBody()).expect(200);
      const other = (path: string, method: 'put' | 'get' | 'delete') =>
        fx.req(method, path, 'stranger', fx.otherGymId);
      await other(`/me/sessions/${s}`, 'put')
        .send({ startedAt: at('08:00') })
        .expect(404);
      await other(`/me/sessions/${s}/sets/${randomUUID()}`, 'put').send(setBody()).expect(404);
      const own = randomUUID();
      await other(`/me/sessions/${own}`, 'put')
        .send({ startedAt: at('08:00') })
        .expect(200);
      await other(`/me/sessions/${own}/sets/${sid}`, 'put')
        .send(setBody({ exerciseId: randomUUID() }))
        .expect(404);
      expect(((await other('/me/sessions', 'get').expect(200)).body as unknown[]).length).toBe(1);
      expect((await mine('m'))[0]!.sets).toHaveLength(1);
    });

    it('deleting a set is idempotent', async () => {
      await clearSessions();
      const s = randomUUID();
      const sid = randomUUID();
      await putMine('m', s).expect(200);
      await putSet('m', s, sid, setBody()).expect(200);
      await fx.req('delete', `/me/sessions/${s}/sets/${sid}`, 'm').expect(204);
      await fx.req('delete', `/me/sessions/${s}/sets/${sid}`, 'm').expect(204);
      await fx.req('delete', `/me/sessions/${s}/sets/${randomUUID()}`, 'm').expect(204);
      expect((await mine())[0]!.sets).toHaveLength(0);
    });
  });

  describe('exercise library for members', () => {
    it('a member lists the unarchived exercises, even when asking for archived ones', async () => {
      const all = (await fx.req('get', '/exercises', 'm').expect(200)).body as Exercise[];
      expect(all.length).toBeGreaterThan(20);
      const archivedId = all.find((e) => e.nameEn === 'Plank')!.id;
      await fx.req('post', `/exercises/${archivedId}/archive`, 'owner').expect(204);
      const after = (await fx.req('get', '/exercises?includeArchived=true', 'm').expect(200))
        .body as Exercise[];
      expect(after.some((e) => e.id === archivedId)).toBe(false);
      const trainer = (await fx.req('get', '/exercises?includeArchived=true', 't').expect(200))
        .body as Exercise[];
      expect(trainer.some((e) => e.id === archivedId)).toBe(true);
      // members still cannot create or change exercises
      await fx
        .req('post', '/exercises', 'm')
        .send({ nameEl: 'Χ', muscleGroup: 'core', measure: 'reps' })
        .expect(403);
      await fx.req('post', `/exercises/${archivedId}/archive`, 'm').expect(403);
      // an archived exercise cannot be newly logged
      const s = randomUUID();
      await putMine('m', s).expect(200);
      await putSet(
        'm',
        s,
        randomUUID(),
        setBody({
          exerciseId: archivedId,
          reps: undefined,
          weightKg: undefined,
          durationSeconds: 30,
        }),
      ).expect(404);
    });
  });
});
