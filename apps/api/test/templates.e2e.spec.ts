import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuditPage, Exercise, MembershipType, Plan, PlanSummary } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import { withGym } from '../src/db/tenant';
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
}
const DAY = '2027-05-12';

describe('plan templates', () => {
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
  const req = (method: 'get' | 'post' | 'put' | 'delete', path: string, who: string, gym = gymId) =>
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
  const body = (over: Record<string, unknown> = {}) => ({
    title: 'Πάνω σώμα',
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
          },
          {
            exerciseId: exIds[1],
            sets: 3,
            toFailure: true,
            restSeconds: 90,
            notes: 'Αργή κάθοδος',
          },
        ],
      },
      {
        title: 'Ημέρα Β',
        exercises: [{ exerciseId: exIds[2], sets: 3, repsMin: 12, repsMax: 12, toFailure: false }],
      },
    ],
    notes: 'Σημειώσεις προγράμματος',
    ...over,
  });
  /** The whole content of a plan without any ids: what a faithful copy must keep, every day and exercise. */
  const contentOf = (p: Plan) => ({
    title: p.title,
    notes: p.notes,
    days: p.days.map((d) => ({
      title: d.title,
      exercises: d.exercises.map(({ id: _id, ...rest }) => rest),
    })),
  });
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
  const planFor = async (member: string, over: Record<string, unknown> = {}) =>
    (await req('post', `/members/${id[member]}/plans`, 't').send(body(over)).expect(201))
      .body as Plan;
  const idsOf = (p: Plan) => [
    ...p.days.map((d) => d.id),
    ...p.days.flatMap((d) => d.exercises.map((e) => e.id)),
  ];
  const saveAsTemplate = async (planId: string, title: string, who = 't') =>
    (await req('post', `/plans/${planId}/save-as-template`, who).send({ title }).expect(201))
      .body as Plan;

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
        { name: `Templates ${run}`, timezone: 'Europe/Athens' },
        { name: `Templates other ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await seedExercises(systemDb, gymId);
    await seedExercises(systemDb, otherGymId);
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('t', ['trainer']);
    await person('v', ['trainer']);
    await person('u', ['trainer']);
    await person('m', ['member']);
    await person('n', ['member']);
    await person('outsider', ['trainer'], otherGymId);
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
      await req('post', `/members/${id[m]}/memberships`, 'rec')
        .send({ typeId: withTrainer.id, amountCents: 4000, method: 'cash' })
        .expect(201);
      await req('put', `/members/${id[m]}/trainer`, 'rec').send({ trainerId: id.t }).expect(200);
    }
    const list = (await req('get', '/exercises', 't').expect(200)).body as Exercise[];
    exIds = ['Bench press', 'Squat', 'Pull-ups'].map((en) => list.find((e) => e.nameEn === en)!.id);
  });

  beforeEach(() => {
    clock.current = new Date(`${DAY}T09:00:00Z`);
  });

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

  it("a trainer saves a client's plan as a template; another trainer sees it but cannot change or delete it", async () => {
    const plan = await planFor('m');
    const tpl = await saveAsTemplate(plan.id, 'Πάνω σώμα (πρότυπο)');
    expect(tpl).toMatchObject({
      isTemplate: true,
      memberId: null,
      kind: 'interactive',
      status: 'draft',
      title: 'Πάνω σώμα (πρότυπο)',
      authorId: id.t,
    });
    // Every day and exercise with every field, in order (days: Α has 2 exercises, Β has 1).
    expect(contentOf(tpl)).toEqual({ ...contentOf(plan), title: 'Πάνω σώμα (πρότυπο)' });
    expect(tpl.days.map((d) => d.exercises.length)).toEqual([2, 1]);
    expect(tpl.days[0]!.exercises[1]).toMatchObject({ restSeconds: 90, notes: 'Αργή κάθοδος' });
    // A deep copy: nothing shared with the client's plan.
    const shared = idsOf(tpl).filter((x) => idsOf(plan).includes(x));
    expect(shared).toEqual([]);

    const list = (await req('get', '/plan-templates', 'v').expect(200)).body as PlanSummary[];
    const row = list.find((p) => p.id === tpl.id)!;
    expect(row).toMatchObject({
      title: 'Πάνω σώμα (πρότυπο)',
      authorName: 't Test',
      authorId: id.t,
    });
    const seen = (await req('get', `/plan-templates/${tpl.id}`, 'v').expect(200)).body as Plan;
    expect(seen.days[0]!.exercises[0]!.exercise.nameEl).toBe('Πιέσεις στήθους');

    await req('put', `/plan-templates/${tpl.id}`, 'v').send(resend(tpl)).expect(403);
    await req('delete', `/plan-templates/${tpl.id}`, 'v').expect(403);
    expect((await req('get', `/plan-templates/${tpl.id}`, 't').expect(200)).body.title).toBe(
      tpl.title,
    );
  });

  it('a template made from scratch is visible to all trainers, hidden from everyone else and other gyms', async () => {
    const tpl = (
      await req('post', '/plan-templates', 'v')
        .send(body({ title: 'Από το μηδέν' }))
        .expect(201)
    ).body as Plan;
    expect(tpl).toMatchObject({ isTemplate: true, memberId: null, authorId: id.v });
    expect(
      ((await req('get', '/plan-templates', 't').expect(200)).body as PlanSummary[]).map(
        (p) => p.id,
      ),
    ).toContain(tpl.id);
    for (const who of ['rec', 'owner', 'm']) {
      await req('get', '/plan-templates', who).expect(403);
      await req('get', `/plan-templates/${tpl.id}`, who).expect(403);
      await req('post', '/plan-templates', who).send(body()).expect(403);
    }
    // Another gym's trainer neither lists it nor reaches it.
    const theirs = (await req('get', '/plan-templates', 'outsider', otherGymId).expect(200))
      .body as PlanSummary[];
    expect(theirs.map((p) => p.id)).not.toContain(tpl.id);
    await req('get', `/plan-templates/${tpl.id}`, 'outsider', otherGymId).expect(404);
    await req('post', '/plan-templates', 't').send({ title: 'Χ', days: [] }).expect(400);
  });

  it('creating a plan from a template copies everything with new ids; editing or deleting the template leaves the plan alone', async () => {
    const source = await planFor('m', { title: 'Πηγή' });
    const tpl = await saveAsTemplate(source.id, 'Πρότυπο για αντιγραφή');
    const made = (
      await req('post', `/members/${id.n}/plans/from-template`, 't')
        .send({ templateId: tpl.id })
        .expect(201)
    ).body as Plan;
    expect(made).toMatchObject({
      memberId: id.n,
      isTemplate: false,
      kind: 'interactive',
      status: 'draft',
      title: 'Πρότυπο για αντιγραφή',
      authorId: id.t,
    });
    expect(contentOf(made)).toEqual(contentOf(tpl));
    expect(made.days.map((d) => d.exercises.length)).toEqual([2, 1]);
    expect(made.days[0]!.exercises[1]).toMatchObject({ restSeconds: 90, notes: 'Αργή κάθοδος' });
    expect(idsOf(made).filter((x) => idsOf(tpl).includes(x))).toEqual([]);
    expect(new Set(idsOf(made)).size).toBe(idsOf(made).length);

    // The other direction: editing the client's plans never reaches the template.
    const tplBefore = contentOf(tpl);
    const editMade = resend(made);
    editMade.title = 'Αλλαγή στο πρόγραμμα';
    editMade.days[1]!.exercises[0]!.sets = 9;
    await req('put', `/plans/${made.id}`, 't').send(editMade).expect(200);
    const editSource = resend(source);
    editSource.days[0]!.title = 'Αλλαγή στην πηγή';
    editSource.days[0]!.exercises.pop();
    await req('put', `/plans/${source.id}`, 't').send(editSource).expect(200);
    const tplNow = (await req('get', `/plan-templates/${tpl.id}`, 't').expect(200)).body as Plan;
    expect(contentOf(tplNow)).toEqual(tplBefore);
    await req('put', `/plans/${made.id}`, 't').send(resend(made)).expect(200); // restore for below

    // Edit the template afterwards: rename a day, drop an exercise, retitle.
    const edit = resend(tpl);
    edit.title = 'Πρότυπο (αλλαγμένο)';
    edit.days[0]!.title = 'Αλλαγμένη';
    edit.days[0]!.exercises.pop();
    await req('put', `/plan-templates/${tpl.id}`, 't').send(edit).expect(200);
    const unchanged = (await req('get', `/plans/${made.id}`, 't').expect(200)).body as Plan;
    expect(unchanged.title).toBe('Πρότυπο για αντιγραφή');
    expect(unchanged.days[0]!.title).toBe(made.days[0]!.title);
    expect(unchanged.days[0]!.exercises).toHaveLength(2);

    // Delete the template: the plan stays.
    await req('delete', `/plan-templates/${tpl.id}`, 't').expect(204);
    await req('get', `/plan-templates/${tpl.id}`, 't').expect(404);
    await req('delete', `/plan-templates/${tpl.id}`, 't').expect(404);
    const stays = (await req('get', `/plans/${made.id}`, 't').expect(200)).body as Plan;
    expect(idsOf(stays)).toEqual(idsOf(made));
    // A template made later from the same source is unaffected by all this.
    expect((await req('get', `/plans/${source.id}`, 't').expect(200)).body.title).toBe('Πηγή');
  });

  it('from-template can activate right away and archives the previous active plan', async () => {
    const tpl = (
      await req('post', '/plan-templates', 't')
        .send(body({ title: 'Ενεργοποίηση' }))
        .expect(201)
    ).body as Plan;
    const first = (
      await req('post', `/members/${id.m}/plans/from-template`, 't')
        .send({ templateId: tpl.id, activate: true })
        .expect(201)
    ).body as Plan;
    expect(first.status).toBe('active');
    const second = (
      await req('post', `/members/${id.m}/plans/from-template`, 't')
        .send({ templateId: tpl.id, activate: true })
        .expect(201)
    ).body as Plan;
    const rows = await systemDb.select().from(plans).where(eq(plans.memberId, id.m!));
    expect(rows.filter((r) => r.status === 'active').map((r) => r.id)).toEqual([second.id]);
    expect(rows.find((r) => r.id === first.id)!.status).toBe('archived');
  });

  it('access: a cover trainer can read the plan but can neither copy it into a template nor create a plan from one; others get 404', async () => {
    const plan = await planFor('m', { title: 'Για κάλυψη' });
    const tpl = (
      await req('post', '/plan-templates', 't')
        .send(body({ title: 'Πρότυπο κάλυψης' }))
        .expect(201)
    ).body as Plan;
    await req('post', `/plans/${plan.id}/save-as-template`, 'u').send({ title: 'Χ' }).expect(404);
    await systemDb
      .insert(trainerCovers)
      .values({ gymId, memberId: id.m!, trainerId: id.u!, date: DAY });
    try {
      // Templates are readable by every trainer of the gym: a cover (read-only) must not feed them.
      await req('post', `/plans/${plan.id}/save-as-template`, 'u')
        .send({ title: 'Από κάλυψη' })
        .expect(403);
      await req('post', `/members/${id.m}/plans/from-template`, 'u')
        .send({ templateId: tpl.id })
        .expect(403);
    } finally {
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, gymId));
    }
    await req('post', `/members/${id.m}/plans/from-template`, 'u')
      .send({ templateId: tpl.id })
      .expect(404);
    // Unknown template, a client plan used as a template, a template of another gym.
    await req('post', `/members/${id.m}/plans/from-template`, 't')
      .send({ templateId: randomUUID() })
      .expect(404);
    await req('post', `/members/${id.m}/plans/from-template`, 't')
      .send({ templateId: plan.id })
      .expect(404);
    const foreign = (
      await req('post', '/plan-templates', 'outsider', otherGymId)
        .send(body({ days: [{ title: 'Α', exercises: [] }], title: 'Ξένο' }))
        .expect(201)
    ).body as Plan;
    await req('post', `/members/${id.m}/plans/from-template`, 't')
      .send({ templateId: foreign.id })
      .expect(404);
    // The template routes never serve a client plan.
    await req('get', `/plan-templates/${plan.id}`, 't').expect(404);
    await req('put', `/plan-templates/${plan.id}`, 't').send(resend(plan)).expect(404);
    await req('delete', `/plan-templates/${plan.id}`, 't').expect(404);
    await req('post', `/plans/${plan.id}/save-as-template`, 't').send({ title: '' }).expect(400);
  });

  it('a copy waits for an edit of the template in progress, then finds it deleted instead of copying half of it', async () => {
    const tpl = (
      await req('post', '/plan-templates', 't')
        .send(body({ title: 'Υπό επεξεργασία' }))
        .expect(201)
    ).body as Plan;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    // The author's transaction: locks the template, empties it, then deletes it, all uncommitted.
    const editing = withGym(gymId, async (tx) => {
      await tx.select().from(plans).where(eq(plans.id, tpl.id)).for('update');
      locked();
      await gate;
      await tx.delete(plans).where(eq(plans.id, tpl.id));
    });
    await holding;
    let settled = false;
    const copying = req('post', `/members/${id.n}/plans/from-template`, 't')
      .send({ templateId: tpl.id })
      .then((r) => {
        settled = true;
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false); // still waiting for the lock
    release();
    await editing;
    expect((await copying).status).toBe(404);
  });

  it('writes template history: created, updated and deleted, with the title and counts only', async () => {
    const tpl = (
      await req('post', '/plan-templates', 't')
        .send(body({ title: 'Ιστορικό προτύπου' }))
        .expect(201)
    ).body as Plan;
    await req('put', `/plan-templates/${tpl.id}`, 't')
      .send({ ...resend(tpl), title: 'Ιστορικό προτύπου 2' })
      .expect(200);
    await req('delete', `/plan-templates/${tpl.id}`, 't').expect(204);
    const page = (
      await req('get', `/audit?entity=plan&entityId=${tpl.id}&limit=100`, 'owner').expect(200)
    ).body as AuditPage;
    expect(page.entries.map((e) => e.action).sort()).toEqual(
      ['template.created', 'template.deleted', 'template.updated'].sort(),
    );
    const created = page.entries.find((e) => e.action === 'template.created')!;
    expect(created.data).toMatchObject({ title: 'Ιστορικό προτύπου', days: 2, exercises: 3 });
    const text = JSON.stringify(page.entries.map((e) => e.data));
    for (const x of exIds) expect(text).not.toContain(x);
    expect(page.entries.every((e) => e.actor?.id === id.t)).toBe(true);
  });

  it('a template keeps working when an exercise in it was archived (it stays in the copy)', async () => {
    const own = (
      await req('post', '/exercises', 't')
        .send({ nameEl: `Προς αρχειοθέτηση ${run}`, muscleGroup: 'core', measure: 'reps' })
        .expect(201)
    ).body as Exercise;
    const tpl = (
      await req('post', '/plan-templates', 't')
        .send(
          body({
            days: [{ title: 'Α', exercises: [{ exerciseId: own.id, sets: 3, toFailure: false }] }],
          }),
        )
        .expect(201)
    ).body as Plan;
    await req('post', `/exercises/${own.id}/archive`, 'owner').expect(204);
    const made = (
      await req('post', `/members/${id.n}/plans/from-template`, 't')
        .send({ templateId: tpl.id })
        .expect(201)
    ).body as Plan;
    expect(made.days[0]!.exercises[0]!.exercise.archived).toBe(true);
  });
});
