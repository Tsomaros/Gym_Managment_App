import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuditPage, Exercise } from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import { auditLog, exercises, gymRoles, gyms, invitations, users } from '../src/db/schema';
import {
  DEFAULT_EXERCISES,
  seedExercises,
  seedGymsWithoutExercises,
} from '../src/exercises/seed-exercises';
import { configureApp } from '../src/main';

describe('exercise library', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  let createdGymId: string;
  const extraGyms: string[] = [];
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const server = () => app.getHttpServer();
  const req = (method: 'get' | 'post' | 'patch', path: string, who: string, gym = gymId) =>
    request(server())[method](`/gyms/${gym}${path}`).auth(tok[who]!, { type: 'bearer' });

  async function person(key: string, roles: string[], gym = gymId, admin = false): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({
        email: `${key.toLowerCase()}-${run}@x.gr`,
        firstName: key,
        lastName: 'Test',
        isPlatformAdmin: admin,
      })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: admin });
    if (roles.length) {
      await systemDb
        .insert(gymRoles)
        .values(roles.map((role) => ({ gymId: gym, userId: u!.id, role }) as never));
    }
  }
  const names = async (who: string, query = '', gym = gymId): Promise<string[]> =>
    ((await req('get', `/exercises${query}`, who, gym).expect(200)).body as Exercise[]).map(
      (e) => e.nameEl,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    const gs = await systemDb
      .insert(gyms)
      .values([{ name: `Ex ${run}` }, { name: `Ex other ${run}` }])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('mem', ['member']);
    await person('t1', ['trainer']);
    await person('t2', ['trainer']);
    await person('outsider', ['trainer'], otherGymId);
    await person('admin', [], gymId, true);
    await seedExercises(systemDb, gymId);
    await seedExercises(systemDb, otherGymId);
  });

  afterAll(async () => {
    const gymIds = [gymId, otherGymId, createdGymId, ...extraGyms].filter(Boolean);
    await systemDb.delete(auditLog).where(inArray(auditLog.gymId, gymIds));
    await systemDb.delete(invitations).where(inArray(invitations.gymId, gymIds));
    await systemDb.delete(exercises).where(inArray(exercises.gymId, gymIds));
    await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
    await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('ships at least 50 default exercises including the required ones', () => {
    expect(DEFAULT_EXERCISES.length).toBeGreaterThanOrEqual(50);
    const byEn = new Map(DEFAULT_EXERCISES.map((e) => [e.nameEn, e]));
    expect(byEn.get('Bench press')).toMatchObject({
      nameEl: 'Πιέσεις στήθους',
      muscleGroup: 'chest',
      measure: 'weight_reps',
    });
    expect(byEn.get('Pull-ups')).toMatchObject({
      nameEl: 'Έλξεις',
      muscleGroup: 'back',
      measure: 'reps',
    });
    expect(byEn.get('Plank')).toMatchObject({
      nameEl: 'Σανίδα',
      muscleGroup: 'core',
      measure: 'duration',
    });
    for (const en of ['Biceps curl', 'Squat', 'Deadlift']) expect(byEn.has(en)).toBe(true);
  });

  it('seeds every default into a gym created by the platform admin, in the same step', async () => {
    const res = await request(server())
      .post('/platform/gyms')
      .auth(tok.admin!, { type: 'bearer' })
      .send({
        name: `Seeded ${run}`,
        ownerEmail: `seeded-owner-${run}@x.gr`,
        ownerFirstName: 'Owner',
        ownerLastName: 'Seeded',
      })
      .expect(201);
    createdGymId = (res.body as { gymId: string }).gymId;
    const rows = await systemDb.select().from(exercises).where(eq(exercises.gymId, createdGymId));
    expect(rows).toHaveLength(DEFAULT_EXERCISES.length);
    expect(rows.map((r) => r.nameEl)).toContain('Πιέσεις στήθους');
  });

  it('seeding twice adds nothing (safe to re-run for an existing gym)', async () => {
    await seedExercises(systemDb, gymId);
    const rows = await systemDb.select().from(exercises).where(eq(exercises.gymId, gymId));
    expect(rows).toHaveLength(DEFAULT_EXERCISES.length);
  });

  it('gives an existing gym with no exercises the defaults at startup, and leaves a gym that archived everything alone', async () => {
    const [fresh, archivedAll] = await systemDb
      .insert(gyms)
      .values([{ name: `Backfill ${run}` }, { name: `Backfill archived ${run}` }])
      .returning({ id: gyms.id });
    extraGyms.push(fresh!.id, archivedAll!.id);
    await systemDb.insert(exercises).values({
      gymId: archivedAll!.id,
      nameEl: 'Μόνη',
      muscleGroup: 'core',
      measure: 'reps',
      archivedAt: new Date(),
    });
    await seedGymsWithoutExercises([fresh!.id, archivedAll!.id]);
    const count = async (g: string) =>
      (await systemDb.select().from(exercises).where(eq(exercises.gymId, g))).length;
    expect(await count(fresh!.id)).toBe(DEFAULT_EXERCISES.length);
    expect(await count(archivedAll!.id)).toBe(1);
  });

  it('finds exercises accent- and case-insensitively, by Greek or English name', async () => {
    expect(await names('t1', '?q=πιεσεις')).toContain('Πιέσεις στήθους');
    expect(await names('t1', '?q=ΠΙΕΣΕΙΣ')).toContain('Πιέσεις στήθους');
    expect(await names('t1', '?q=bench')).toContain('Πιέσεις στήθους');
    expect(await names('t1', '?q=zzzz-nothing')).toEqual([]);
  });

  it('treats % and _ in the search text as plain characters, not wildcards', async () => {
    expect(await names('t1', '?q=%25')).toEqual([]);
    expect(await names('t1', '?q=_')).toEqual([]);
  });

  it('filters by muscle group and returns the list sorted by name', async () => {
    const list = (await req('get', '/exercises?muscleGroup=core', 't1').expect(200))
      .body as Exercise[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((e) => e.muscleGroup === 'core')).toBe(true);
    const sorted = [...list].sort((a, b) => a.nameEl.localeCompare(b.nameEl, 'el'));
    expect(list.map((e) => e.nameEl)).toEqual(sorted.map((e) => e.nameEl));
    expect((await req('get', '/exercises', 't1').expect(200)).body).toHaveLength(
      Math.min(DEFAULT_EXERCISES.length, 200),
    );
  });

  it('lets a trainer add an exercise (201 + history) and rejects the same Greek name in another case (409)', async () => {
    const res = await req('post', '/exercises', 't1')
      .send({ nameEl: 'Ώμοι με αλτήρες', muscleGroup: 'shoulders', measure: 'weight_reps' })
      .expect(201);
    expect(res.body).toMatchObject({
      nameEl: 'Ώμοι με αλτήρες',
      nameEn: null,
      archived: false,
      createdBy: id.t1,
    });
    await req('post', '/exercises', 't2')
      .send({ nameEl: 'ΏΜΟΙ ΜΕ ΑΛΤΉΡΕΣ', muscleGroup: 'shoulders', measure: 'weight_reps' })
      .expect(409);
    const history = (await req('get', '/audit?entity=exercise', 'owner').expect(200))
      .body as AuditPage;
    expect(history.entries.map((e) => e.action)).toContain('exercise.created');
  });

  it('validates the body', async () => {
    await req('post', '/exercises', 't1')
      .send({ nameEl: '', muscleGroup: 'chest', measure: 'reps' })
      .expect(400);
    await req('post', '/exercises', 't1')
      .send({ nameEl: 'Κάτι', muscleGroup: 'wings', measure: 'reps' })
      .expect(400);
    await req('post', '/exercises', 't1')
      .send({ nameEl: 'Κάτι', muscleGroup: 'chest', measure: 'miles' })
      .expect(400);
  });

  it('lets any trainer or the owner edit an exercise, and records it', async () => {
    const created = (
      await req('post', '/exercises', 't1')
        .send({ nameEl: 'Δοκιμαστική κίνηση', muscleGroup: 'legs', measure: 'reps' })
        .expect(201)
    ).body as Exercise;
    const patched = await req('patch', `/exercises/${created.id}`, 't2')
      .send({ nameEn: 'Test move', measure: 'weight_reps' })
      .expect(200);
    expect(patched.body).toMatchObject({
      nameEn: 'Test move',
      measure: 'weight_reps',
      nameEl: 'Δοκιμαστική κίνηση',
    });
    await req('patch', `/exercises/${created.id}`, 'owner')
      .send({ muscleGroup: 'glutes' })
      .expect(200);
    // Renaming onto another exercise's Greek name collides.
    await req('patch', `/exercises/${created.id}`, 't1').send({ nameEl: 'σανίδα' }).expect(409);
    const history = (await req('get', '/audit?entity=exercise', 'owner').expect(200))
      .body as AuditPage;
    expect(history.entries.map((e) => e.action)).toContain('exercise.updated');
    // Accent-only variant of an existing default ("Σανίδα") is also a duplicate.
    await req('patch', `/exercises/${created.id}`, 't1').send({ nameEl: 'ΣΑΝΙΔΑ' }).expect(409);
    // Re-saving its own name in another case is not a collision with itself.
    await req('patch', `/exercises/${created.id}`, 't1')
      .send({ nameEl: 'ΔΟΚΙΜΑΣΤΙΚΉ κίνηση' })
      .expect(200);
    await req('patch', `/exercises/${created.id}`, 't1').send({}).expect(400);
  });

  it('archives: another trainer 403, the creator or the owner 204; hidden by default, shown with includeArchived', async () => {
    const created = (
      await req('post', '/exercises', 't1')
        .send({ nameEl: 'Προς αρχειοθέτηση', muscleGroup: 'back', measure: 'reps' })
        .expect(201)
    ).body as Exercise;
    await req('post', `/exercises/${created.id}/archive`, 't2').expect(403);
    await req('post', `/exercises/${created.id}/archive`, 'owner').expect(204);
    expect(await names('t1')).not.toContain('Προς αρχειοθέτηση');
    expect(await names('t1', '?includeArchived=true')).toContain('Προς αρχειοθέτηση');
    const hidden = (await req('get', '/exercises?includeArchived=true', 't1').expect(200))
      .body as Exercise[];
    expect(hidden.find((e) => e.id === created.id)?.archived).toBe(true);

    const second = (
      await req('post', '/exercises', 't1')
        .send({ nameEl: 'Αρχειοθέτηση από δημιουργό', muscleGroup: 'back', measure: 'reps' })
        .expect(201)
    ).body as Exercise;
    await req('post', `/exercises/${second.id}/archive`, 't1').expect(204);
    const history = (await req('get', '/audit?entity=exercise', 'owner').expect(200))
      .body as AuditPage;
    expect(history.entries.filter((e) => e.action === 'exercise.archived')).toHaveLength(2);
  });

  it('keeps an archived exercise name reserved and archiving twice records once', async () => {
    const created = (
      await req('post', '/exercises', 't1')
        .send({ nameEl: 'Δεσμευμένο όνομα', muscleGroup: 'core', measure: 'reps' })
        .expect(201)
    ).body as Exercise;
    await req('post', `/exercises/${created.id}/archive`, 't1').expect(204);
    await req('post', `/exercises/${created.id}/archive`, 't1').expect(204);
    await req('post', '/exercises', 't2')
      .send({ nameEl: 'δεσμευμένο όνομα', muscleGroup: 'core', measure: 'reps' })
      .expect(409);
    const history = (await req('get', '/audit?entity=exercise', 'owner').expect(200))
      .body as AuditPage;
    // Two earlier archives plus exactly one for this exercise.
    expect(history.entries.filter((e) => e.action === 'exercise.archived')).toHaveLength(3);
  });

  it('answers 404 for archiving or editing an unknown exercise or one of another gym', async () => {
    const foreign = (
      await systemDb.select().from(exercises).where(eq(exercises.gymId, otherGymId))
    )[0]!;
    await req('post', `/exercises/${foreign.id}/archive`, 'owner').expect(404);
    await req('patch', `/exercises/${foreign.id}`, 't1').send({ nameEn: 'x' }).expect(404);
    await req('patch', `/exercises/${randomUUID()}`, 't1').send({ nameEn: 'x' }).expect(404);
  });

  it('is closed to members and reception, and to other gyms', async () => {
    await req('get', '/exercises', 'mem').expect(403);
    await req('get', '/exercises', 'rec').expect(403);
    await req('post', '/exercises', 'rec')
      .send({ nameEl: 'Χ', muscleGroup: 'core', measure: 'reps' })
      .expect(403);
    await req('get', '/exercises', 'outsider').expect(403);
    await req('get', '/exercises', 'owner').expect(200);
  });

  it('gives the platform admin no implicit access, and rejects a malformed id', async () => {
    await req('get', '/exercises', 'admin').expect(403);
    await req('post', '/exercises', 'admin')
      .send({ nameEl: 'Admin move', muscleGroup: 'core', measure: 'reps' })
      .expect(403);
    await req('patch', '/exercises/not-a-uuid', 't1').send({ nameEn: 'x' }).expect(400);
    await req('post', '/exercises/not-a-uuid/archive', 't1').expect(400);
  });

  it('keeps two gyms apart: the same Greek name may exist in both, and lists never mix', async () => {
    await req('post', '/exercises', 'outsider', otherGymId)
      .send({ nameEl: 'Μόνο στο άλλο γυμναστήριο', muscleGroup: 'core', measure: 'reps' })
      .expect(201);
    expect(await names('t1')).not.toContain('Μόνο στο άλλο γυμναστήριο');
    expect(await names('outsider', '', otherGymId)).toContain('Μόνο στο άλλο γυμναστήριο');
    // "Σανίδα" is a default in both gyms already.
    expect(await names('outsider', '?q=σανιδα', otherGymId)).toContain('Σανίδα');
  });
});
