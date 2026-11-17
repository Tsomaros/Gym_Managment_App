import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuditPage, Exercise, MembershipType, Plan, PlanSummary } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  exercises,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  memberTrainers,
  payments,
  plans,
  trainerCovers,
  users,
} from '../src/db/schema';
import { seedExercises } from '../src/exercises/seed-exercises';
import { configureApp } from '../src/main';

class TestClock {
  current = new Date('2027-05-12T09:00:00Z');
  now(): Date {
    return this.current;
  }
  setDay(iso: string): void {
    this.current = new Date(`${iso}T09:00:00Z`);
  }
}

// 2027-05-12 is a Wednesday; the gym is in Europe/Athens.
const DAY = '2027-05-12';

describe('workout plans: interactive plans, access rules, activation', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  let withTrainer: MembershipType;
  let exIds: string[] = [];
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const server = () => app.getHttpServer();
  const req = (method: 'get' | 'post' | 'put', path: string, who: string, gym = gymId) =>
    request(server())[method](`/gyms/${gym}${path}`).auth(tok[who]!, { type: 'bearer' });

  async function person(key: string, roles: string[], gym = gymId): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${key.toLowerCase()}-${run}@x.gr`, firstName: key, lastName: 'Test' })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb
      .insert(gymRoles)
      .values(roles.map((role) => ({ gymId: gym, userId: u!.id, role }) as never));
  }
  const sell = (member: string) =>
    req('post', `/members/${id[member]}/memberships`, 'rec')
      .send({ typeId: withTrainer.id, amountCents: 4000, method: 'cash' })
      .expect(201);
  const assign = (member: string, trainer: string) =>
    req('put', `/members/${id[member]}/trainer`, 'rec')
      .send({ trainerId: id[trainer] })
      .expect(200);

  /** A two-day body; the first day's two exercises and the second day's one. */
  const body = (over: Record<string, unknown> = {}) => ({
    title: 'Πάνω σώμα',
    notes: 'Τρεις φορές την εβδομάδα',
    days: [
      {
        title: 'Ημέρα Α',
        exercises: [
          {
            exerciseId: exIds[0],
            sets: 4,
            repsMin: 8,
            repsMax: 10,
            toFailure: false,
            weightKg: 50,
            restSeconds: 90,
          },
          { exerciseId: exIds[1], sets: 3, toFailure: true },
        ],
      },
      {
        title: 'Ημέρα Β',
        exercises: [{ exerciseId: exIds[2], sets: 3, repsMin: 12, repsMax: 12, toFailure: false }],
      },
    ],
    ...over,
  });
  const create = async (member: string, who: string, over: Record<string, unknown> = {}) =>
    (await req('post', `/members/${id[member]}/plans`, who).send(body(over)).expect(201))
      .body as Plan;
  const idsOf = (p: Plan) => ({
    days: p.days.map((d) => d.id),
    exercises: p.days.flatMap((d) => d.exercises.map((e) => e.id)),
  });
  /** The PUT body that resends a stored plan unchanged. */
  const resend = (p: Plan) => ({
    title: p.title,
    notes: p.notes,
    days: p.days.map((d) => ({
      id: d.id,
      title: d.title,
      exercises: d.exercises.map((e) => ({
        id: e.id,
        exerciseId: e.exerciseId,
        sets: e.sets,
        repsMin: e.repsMin,
        repsMax: e.repsMax,
        toFailure: e.toFailure,
        weightKg: e.weightKg,
        restSeconds: e.restSeconds,
        durationSeconds: e.durationSeconds,
        notes: e.notes,
      })),
    })),
  });
  const history = async (planId: string) =>
    (await req('get', `/audit?entity=plan&entityId=${planId}&limit=100`, 'owner').expect(200))
      .body as AuditPage;
  const activeIds = async (member: string) =>
    (await systemDb.select().from(plans).where(eq(plans.memberId, id[member]!))).filter(
      (p) => p.status === 'active',
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    const gs = await systemDb
      .insert(gyms)
      .values([
        { name: `Plans ${run}`, timezone: 'Europe/Athens' },
        { name: `Plans other ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await seedExercises(systemDb, gymId);
    await seedExercises(systemDb, otherGymId);
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('t', ['trainer']);
    await person('u', ['trainer']);
    await person('m', ['member']);
    await person('n', ['member']);
    await person('stranger', ['member'], otherGymId);
    await person('outsiderTrainer', ['trainer'], otherGymId);
    clock.setDay(DAY);
    withTrainer = (
      await req('post', '/membership-types', 'owner')
        .send({
          name: 'Με γυμναστή',
          kind: 'time',
          durationMonths: 1,
          priceCents: 4000,
          maxFreezeDays: 0,
          includesTrainer: true,
        })
        .expect(201)
    ).body as MembershipType;
    for (const m of ['m', 'n']) {
      await sell(m);
      await assign(m, 't');
    }
    const list = (await req('get', '/exercises', 't').expect(200)).body as Exercise[];
    // Bench press (chest), Squat, Pull-ups, Deadlift, Plank: fixed by their English names.
    exIds = ['Bench press', 'Squat', 'Pull-ups', 'Deadlift', 'Plank'].map(
      (en) => list.find((e) => e.nameEn === en)!.id,
    );
  });

  beforeEach(() => clock.setDay(DAY));

  afterAll(async () => {
    for (const g of [gymId, otherGymId].filter(Boolean)) {
      await systemDb.delete(plans).where(eq(plans.gymId, g));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, g));
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, g));
      await systemDb.delete(memberTrainers).where(eq(memberTrainers.gymId, g));
      await systemDb.delete(payments).where(eq(payments.gymId, g));
      await systemDb.delete(memberships).where(eq(memberships.gymId, g));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, g));
      await systemDb.delete(exercises).where(eq(exercises.gymId, g));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, g));
      await systemDb.delete(gyms).where(eq(gyms.id, g));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('the primary trainer creates and activates a two-day plan; the member reads it with exercise names', async () => {
    const plan = await create('m', 't', { activate: true });
    expect(plan).toMatchObject({
      memberId: id.m,
      authorId: id.t,
      author: { firstName: 't', lastName: 'Test' },
      isTemplate: false,
      kind: 'interactive',
      status: 'active',
      pdfUrl: null,
    });
    expect(plan.activatedAt).not.toBeNull();
    expect(plan.days.map((d) => d.title)).toEqual(['Ημέρα Α', 'Ημέρα Β']);
    expect(plan.days[0]!.exercises.map((e) => e.exerciseId)).toEqual([exIds[0], exIds[1]]);
    expect(plan.days[0]!.exercises[0]).toMatchObject({
      sets: 4,
      repsMin: 8,
      repsMax: 10,
      toFailure: false,
      weightKg: 50,
      restSeconds: 90,
    });
    expect(plan.days[0]!.exercises[1]).toMatchObject({ toFailure: true, repsMin: null });

    const mine = (await req('get', '/me/plans/active', 'm').expect(200)).body as Plan;
    expect(mine.id).toBe(plan.id);
    const first = mine.days[0]!.exercises[0]!.exercise;
    expect(first.nameEl).toBe('Πιέσεις στήθους');
    expect(first.nameEn).toBe('Bench press');
    expect(first.measure).toBe('weight_reps');
    const asTrainer = (await req('get', `/members/${id.m}/plans/active`, 't').expect(200))
      .body as Plan;
    expect(asTrainer.id).toBe(plan.id);
    expect((await req('get', `/plans/${plan.id}`, 'm').expect(200)).body.id).toBe(plan.id);
  });

  it('an edit keeps the ids of untouched and changed items, deletes the removed one and gives only the added one a new id', async () => {
    const before = await create('n', 't', { activate: true });
    const [dayA, dayB] = before.days as [Plan['days'][0], Plan['days'][0]];
    const [exA, exB] = dayA.exercises as [
      Plan['days'][0]['exercises'][0],
      Plan['days'][0]['exercises'][0],
    ];
    const put = resend(before);
    put.days[0]!.title = 'Ημέρα Α – Στήθος'; // rename day 1
    put.days[0]!.exercises[0]!.repsMax = 12; // change exercise A's reps
    put.days[0]!.exercises.splice(1, 1); // remove exercise B
    put.days[0]!.exercises.push({
      exerciseId: exIds[3]!,
      sets: 2,
      toFailure: false,
    } as never); // add C
    const res = await req('put', `/plans/${before.id}`, 't').send(put).expect(200);
    const after = res.body as Plan;

    expect(after.days.map((d) => d.id)).toEqual([dayA.id, dayB.id]);
    expect(after.days[0]!.title).toBe('Ημέρα Α – Στήθος');
    const afterExIds = after.days[0]!.exercises.map((e) => e.id);
    expect(afterExIds[0]).toBe(exA.id);
    expect(after.days[0]!.exercises[0]!.repsMax).toBe(12);
    expect(afterExIds).not.toContain(exB.id);
    expect(afterExIds[1]).not.toBe(exB.id);
    expect(after.days[0]!.exercises[1]!.exerciseId).toBe(exIds[3]);
    expect(after.days[1]!.exercises.map((e) => e.id)).toEqual(dayB.exercises.map((e) => e.id));
    // The same plan comes back from a fresh read; B is gone from the database.
    const reread = (await req('get', `/plans/${before.id}`, 't').expect(200)).body as Plan;
    expect(idsOf(reread)).toEqual(idsOf(after));
    const still = await systemDb.execute(sql`select 1 from plan_exercises where id = ${exB.id}`);
    expect(still.rows).toHaveLength(0);
  });

  it('reordering days and moving an exercise to another day keeps their ids', async () => {
    const plan = await create('m', 't');
    const put = resend(plan);
    const moved = put.days[0]!.exercises.pop()!; // second exercise of day 1 ...
    put.days[1]!.exercises.unshift(moved); // ... becomes first of day 2
    put.days.reverse();
    const after = (await req('put', `/plans/${plan.id}`, 't').send(put).expect(200)).body as Plan;
    expect(after.days.map((d) => d.id)).toEqual([plan.days[1]!.id, plan.days[0]!.id]);
    expect(after.days[0]!.exercises.map((e) => e.id)).toEqual([
      plan.days[0]!.exercises[1]!.id,
      plan.days[1]!.exercises[0]!.id,
    ]);
    await req('post', `/plans/${plan.id}/archive`, 't').expect(204);
  });

  it('activating plan 2 archives plan 1; two activations at once leave exactly one active plan; history lists all', async () => {
    const mine = (await req('get', `/members/${id.m}/plans`, 't').expect(200))
      .body as PlanSummary[];
    for (const p of mine.filter((p) => p.status !== 'archived')) {
      await req('post', `/plans/${p.id}/archive`, 't').expect(204);
    }
    const one = await create('m', 't', { title: 'Ένα', activate: true });
    const two = await create('m', 't', { title: 'Δύο' });
    const three = await create('m', 't', { title: 'Τρία' });
    expect(two.status).toBe('draft');

    await req('post', `/plans/${two.id}/activate`, 't').expect(200);
    const afterTwo = (await req('get', `/members/${id.m}/plans`, 't').expect(200))
      .body as PlanSummary[];
    expect(afterTwo.find((p) => p.id === one.id)!.status).toBe('archived');
    expect(afterTwo.find((p) => p.id === two.id)!.status).toBe('active');
    expect(afterTwo[0]!.id).toBe(two.id); // active first

    // Two activations at once (plan 1 is archived and cannot come back, so use two drafts).
    // One race can be won by timing alone (the requests finish one after the other), so repeat it:
    // without the per-member lock the unique index turns a lost race into a 500 or two actives.
    const four = await create('m', 't', { title: 'Τέσσερα' });
    let pair = [three, four];
    for (let round = 0; round < 10; round++) {
      const results = await Promise.all(
        pair.map((p) => req('post', `/plans/${p.id}/activate`, 't')),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const active = await activeIds('m');
      expect(active).toHaveLength(1);
      // The winner is one of the pair; the other was archived by the later activation.
      expect(pair.map((p) => p.id)).toContain(active[0]!.id);
      const loser = pair.find((p) => p.id !== active[0]!.id)!;
      const loserRow = (await systemDb.select().from(plans).where(eq(plans.id, loser.id)))[0]!;
      expect(loserRow.status).toBe('archived');
      pair = [
        await create('m', 't', { title: `Γύρος ${round}` }),
        await create('m', 't', { title: `Γύρος ${round}β` }),
      ];
    }

    const all = (await req('get', '/me/plans', 'm').expect(200)).body as PlanSummary[];
    expect(all.map((p) => p.title)).toEqual(
      expect.arrayContaining(['Ένα', 'Δύο', 'Τρία', 'Τέσσερα']),
    );
    expect(all[0]!.status).toBe('active');
    expect(all.slice(1).every((p) => p.status === 'archived')).toBe(true);
    expect(all.find((p) => p.id === one.id)!.authorName).toBe('t Test');
  });

  it('a cover trainer reads today but cannot change anything, and has no access the next day', async () => {
    const [existing] = await activeIds('m');
    const planId = existing!.id;
    await systemDb
      .insert(trainerCovers)
      .values({ gymId, memberId: id.m!, trainerId: id.u!, date: DAY });
    const read = await req('get', `/members/${id.m}/plans/active`, 'u').expect(200);
    expect((read.body as Plan).id).toBe(planId);
    await req('get', `/plans/${planId}`, 'u').expect(200);
    await req('get', `/members/${id.m}/plans`, 'u').expect(200);

    const plan = (await req('get', `/plans/${planId}`, 'u').expect(200)).body as Plan;
    await req('put', `/plans/${planId}`, 'u').send(resend(plan)).expect(403);
    await req('post', `/plans/${planId}/activate`, 'u').expect(403);
    await req('post', `/plans/${planId}/archive`, 'u').expect(403);
    await req('post', `/members/${id.m}/plans`, 'u').send(body()).expect(403);

    clock.setDay('2027-05-13');
    await req('get', `/members/${id.m}/plans/active`, 'u').expect(404);
    await req('get', `/plans/${planId}`, 'u').expect(404);
    await req('put', `/plans/${planId}`, 'u').send(resend(plan)).expect(404);
    await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, gymId));
  });

  it('a trainer whose link is paused (no current membership with a trainer) gets 404', async () => {
    await create('n', 't');
    await req('get', `/members/${id.n}/plans`, 't').expect(200);
    clock.setDay('2027-07-01'); // the one-month membership has ended
    await req('get', `/members/${id.n}/plans`, 't').expect(404);
    await req('get', `/members/${id.n}/plans/active`, 't').expect(404);
    await req('post', `/members/${id.n}/plans`, 't').send(body()).expect(404);
    // The member still sees their own plans.
    await req('get', '/me/plans', 'n').expect(200);
  });

  it('reception, other members and other gyms cannot reach a member plan', async () => {
    const [active] = await activeIds('m');
    await req('get', `/members/${id.m}/plans`, 'rec').expect(403);
    await req('get', `/members/${id.m}/plans`, 'owner').expect(403);
    await req('get', `/plans/${active!.id}`, 'rec').expect(403);
    // The member cannot write.
    const plan = (await req('get', `/plans/${active!.id}`, 'm').expect(200)).body as Plan;
    await req('put', `/plans/${active!.id}`, 'm').send(resend(plan)).expect(403);
    await req('post', `/plans/${active!.id}/archive`, 'm').expect(403);
    await req('post', `/members/${id.m}/plans`, 'm').send(body()).expect(403);
    // Another member sees nothing of it; a trainer who is not theirs does not either.
    await req('get', `/members/${id.m}/plans`, 'n').expect(404);
    await req('get', `/plans/${active!.id}`, 'n').expect(404);
    await req('get', `/members/${id.m}/plans`, 'u').expect(404);
    // Members of another gym and users who are not members at all.
    await req('get', `/members/${id.stranger}/plans`, 't').expect(404);
    await req('get', `/members/${id.t}/plans`, 't').expect(404);
    await req('get', `/plans/${randomUUID()}`, 't').expect(404);
    await req('get', `/plans/${active!.id}`, 'outsiderTrainer', otherGymId).expect(404);
    await req('get', `/plans/${active!.id}`, 'outsiderTrainer').expect(403);
    // /me needs a member role.
    await req('get', '/me/plans', 't').expect(403);
  });

  it('a member does not see drafts, and a plan that is not theirs is a 404 for the member routes', async () => {
    const draft = await create('m', 't', { title: 'Πρόχειρο' });
    await req('get', `/plans/${draft.id}`, 'm').expect(404);
    const mine = (await req('get', '/me/plans', 'm').expect(200)).body as PlanSummary[];
    expect(mine.map((p) => p.id)).not.toContain(draft.id);
    const trainersView = (await req('get', `/members/${id.m}/plans`, 't').expect(200))
      .body as PlanSummary[];
    expect(trainersView.map((p) => p.id)).toContain(draft.id);
    await req('post', `/plans/${draft.id}/archive`, 't').expect(204);
  });

  it('a draft the trainer archived without ever activating stays hidden from the member', async () => {
    const abandoned = await create('m', 't', { title: 'Εγκαταλείφθηκε' });
    await req('post', `/plans/${abandoned.id}/archive`, 't').expect(204);
    await req('get', `/plans/${abandoned.id}`, 'm').expect(404);
    const mine = (await req('get', '/me/plans', 'm').expect(200)).body as PlanSummary[];
    expect(mine.map((p) => p.id)).not.toContain(abandoned.id);
    // The trainer still sees it in the history.
    const theirs = (await req('get', `/members/${id.m}/plans`, 't').expect(200))
      .body as PlanSummary[];
    expect(theirs.find((p) => p.id === abandoned.id)?.status).toBe('archived');
  });

  it('without an active plan, the active route is 404', async () => {
    await person('fresh', ['member']);
    await sell('fresh');
    await assign('fresh', 't');
    await req('get', `/members/${id.fresh}/plans/active`, 't').expect(404);
    await req('get', '/me/plans/active', 'fresh').expect(404);
    expect((await req('get', '/me/plans', 'fresh').expect(200)).body).toEqual([]);
  });

  it('library rules: an archived exercise cannot be added but stays in a plan that has it; another gym or unknown exercise is 400', async () => {
    // Own exercises, so archiving them cannot disturb the other tests.
    const mk = async (nameEl: string) =>
      (
        await req('post', '/exercises', 't')
          .send({ nameEl, muscleGroup: 'core', measure: 'reps' })
          .expect(201)
      ).body as Exercise;
    const keep = (await mk(`Θα αρχειοθετηθεί Α ${run}`)).id;
    const spare = (await mk(`Θα αρχειοθετηθεί Β ${run}`)).id;
    const plan = await create('m', 't', {
      title: 'Βιβλιοθήκη',
      days: [
        {
          title: 'Α',
          exercises: [
            { exerciseId: exIds[0], sets: 3, toFailure: false },
            { exerciseId: keep, sets: 3, toFailure: false },
          ],
        },
        { title: 'Β', exercises: [{ exerciseId: exIds[1], sets: 3, toFailure: false }] },
      ],
    });
    await req('post', `/exercises/${keep}/archive`, 'owner').expect(204);
    await req('post', `/exercises/${spare}/archive`, 'owner').expect(204);

    // Already in the plan: saves fine (and the plan still shows it, flagged archived).
    const stays = (await req('put', `/plans/${plan.id}`, 't').send(resend(plan)).expect(200))
      .body as Plan;
    expect(stays.days[0]!.exercises[1]!.exercise.archived).toBe(true);
    expect(stays.days[0]!.exercises[0]!.exercise.archived).toBe(false);
    // Newly added: rejected.
    const add = resend(plan);
    add.days[1]!.exercises.push({ exerciseId: spare, sets: 3, toFailure: false } as never);
    await req('put', `/plans/${plan.id}`, 't').send(add).expect(400);
    await req('post', `/members/${id.m}/plans`, 't')
      .send(body({ days: [{ title: 'Α', exercises: [{ exerciseId: spare, sets: 1 }] }] }))
      .expect(400);
    // Another gym's exercise and a made-up id.
    const foreign = (
      await systemDb.select().from(exercises).where(eq(exercises.gymId, otherGymId))
    )[0]!.id;
    for (const exerciseId of [foreign, randomUUID()]) {
      const bad = resend(plan);
      bad.days[1]!.exercises.push({ exerciseId, sets: 3, toFailure: false } as never);
      await req('put', `/plans/${plan.id}`, 't').send(bad).expect(400);
    }
    await req('post', `/plans/${plan.id}/archive`, 't').expect(204);
  });

  it("another plan's day or exercise id is 400, and a failed save changes nothing", async () => {
    const mine = await create('m', 't', { title: 'Δικό μου' });
    const other = await create('n', 't', { title: 'Άλλου' });
    const foreignDay = resend(mine);
    foreignDay.days[0]!.id = other.days[0]!.id;
    await req('put', `/plans/${mine.id}`, 't').send(foreignDay).expect(400);
    const foreignEx = resend(mine);
    foreignEx.days[0]!.exercises[0]!.id = other.days[0]!.exercises[0]!.id;
    await req('put', `/plans/${mine.id}`, 't').send(foreignEx).expect(400);
    const unknown = resend(mine);
    unknown.days[0]!.id = randomUUID();
    await req('put', `/plans/${mine.id}`, 't').send(unknown).expect(400);

    const reread = (await req('get', `/plans/${mine.id}`, 't').expect(200)).body as Plan;
    expect(idsOf(reread)).toEqual(idsOf(mine));
    const otherAgain = (await req('get', `/plans/${other.id}`, 't').expect(200)).body as Plan;
    expect(idsOf(otherAgain)).toEqual(idsOf(other));
    await req('post', `/plans/${mine.id}/archive`, 't').expect(204);
    await req('post', `/plans/${other.id}/archive`, 't').expect(204);
  });

  it('an archived plan is read-only (409) and cannot be activated again; invalid bodies are 400', async () => {
    const plan = await create('m', 't', { title: 'Παλιό' });
    await req('post', `/plans/${plan.id}/archive`, 't').expect(204);
    await req('post', `/plans/${plan.id}/archive`, 't').expect(204); // idempotent
    await req('put', `/plans/${plan.id}`, 't').send(resend(plan)).expect(409);
    await req('post', `/plans/${plan.id}/activate`, 't').expect(409);
    const fresh = await create('m', 't', { title: 'Έγκυρο' });
    await req('put', `/plans/${fresh.id}`, 't').send({ title: '', days: [] }).expect(400);
    await req('post', `/members/${id.m}/plans`, 't').send({ title: 'Χ', days: [] }).expect(400);
    await req('post', `/plans/${fresh.id}/archive`, 't').expect(204);
  });

  it('writes history: created, activated, updated and archived, with titles and counts but no exercise details', async () => {
    const plan = await create('m', 't', { title: 'Ιστορικό', activate: true });
    await req('put', `/plans/${plan.id}`, 't')
      .send({ ...resend(plan), title: 'Ιστορικό 2' })
      .expect(200);
    await req('post', `/plans/${plan.id}/archive`, 't').expect(204);
    const page = await history(plan.id);
    const actions = page.entries.map((e) => e.action);
    for (const a of ['plan.created', 'plan.activated', 'plan.updated', 'plan.archived']) {
      expect(actions).toContain(a);
    }
    const created = page.entries.find((e) => e.action === 'plan.created')!;
    expect(created.data).toMatchObject({
      title: 'Ιστορικό',
      memberId: id.m,
      days: 2,
      exercises: 3,
    });
    const text = JSON.stringify(page.entries.map((e) => e.data));
    for (const exId of exIds) expect(text).not.toContain(exId);
    expect(text).not.toContain('Πιέσεις στήθους');
    expect(page.entries.every((e) => e.actor?.id === id.t)).toBe(true);
  });

  it('one active plan per member survives a plan created with activate while another is active', async () => {
    const a = await create('m', 't', { title: 'Α', activate: true });
    const b = await create('m', 't', { title: 'Β', activate: true });
    const active = await activeIds('m');
    expect(active.map((p) => p.id)).toEqual([b.id]);
    const aRow = (
      await systemDb
        .select()
        .from(plans)
        .where(and(eq(plans.id, a.id)))
    )[0]!;
    expect(aRow.status).toBe('archived');
    expect(aRow.archivedAt).not.toBeNull();
  });
});
