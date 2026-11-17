import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { MembershipType } from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import { auditLog, gymRoles, gyms, membershipTypes, users } from '../src/db/schema';
import { createApp } from '../src/main';

describe('membership types', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymA: string;
  let gymB: string;
  const token = { ownerA: '', receptionA: '', ownerB: '', trainerA: '' };

  const server = () => app.getHttpServer();
  const base = (gymId: string) => `/gyms/${gymId}/membership-types`;
  const monthly = {
    name: 'Μηνιαία',
    kind: 'time',
    durationMonths: 1,
    priceCents: 4000,
    maxFreezeDays: 14,
  };

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Types A ${run}` }, { name: `Types B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `oa-${run}@x.gr`, firstName: 'Owner', lastName: 'A' },
        { email: `ra-${run}@x.gr`, firstName: 'Reception', lastName: 'A' },
        { email: `ob-${run}@x.gr`, firstName: 'Owner', lastName: 'B' },
        { email: `ta-${run}@x.gr`, firstName: 'Trainer', lastName: 'A' },
      ])
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: u[0]!.id, role: 'owner' },
      { gymId: gymA, userId: u[1]!.id, role: 'reception' },
      { gymId: gymB, userId: u[2]!.id, role: 'owner' },
      { gymId: gymA, userId: u[3]!.id, role: 'trainer' },
    ]);
    token.ownerA = signAccessToken({ sub: u[0]!.id, adm: false });
    token.receptionA = signAccessToken({ sub: u[1]!.id, adm: false });
    token.ownerB = signAccessToken({ sub: u[2]!.id, adm: false });
    token.trainerA = signAccessToken({ sub: u[3]!.id, adm: false });
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(auditLog).where(inArray(auditLog.gymId, gymIds));
      await systemDb.delete(membershipTypes).where(inArray(membershipTypes.gymId, gymIds));
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  const create = (bearer: string, body: Record<string, unknown> = monthly, gymId = gymA) =>
    request(server()).post(base(gymId)).auth(bearer, { type: 'bearer' }).send(body);
  const list = (bearer: string, query = '', gymId = gymA) =>
    request(server())
      .get(`${base(gymId)}${query}`)
      .auth(bearer, { type: 'bearer' });

  it('lets the owner create a type and returns it in full', async () => {
    const res = await create(token.ownerA);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Μηνιαία',
      nameEn: null,
      kind: 'time',
      durationMonths: 1,
      visitCount: null,
      validityDays: null,
      priceCents: 4000,
      maxFreezeDays: 14,
      includesTrainer: false,
      includesClasses: false,
      archived: false,
    });
    expect(typeof res.body.id).toBe('string');
  });

  it('rejects an invalid type with 400 (visit pack with freeze days)', async () => {
    const res = await create(token.ownerA, {
      name: 'Δεκάρα',
      kind: 'visits',
      visitCount: 10,
      priceCents: 5000,
      maxFreezeDays: 5,
    });
    expect(res.status).toBe(400);
  });

  it('refuses reception and trainers on writes, lets reception read', async () => {
    expect((await create(token.receptionA)).status).toBe(403);
    expect((await create(token.trainerA)).status).toBe(403);
    expect((await list(token.receptionA)).status).toBe(200);
    expect((await list(token.trainerA)).status).toBe(403);
  });

  it('edits a type with PATCH and archives it; archived types are hidden unless asked for', async () => {
    const created = (await create(token.ownerA, { ...monthly, name: 'Τρίμηνη', durationMonths: 3 }))
      .body as MembershipType;

    const patched = await request(server())
      .patch(`${base(gymA)}/${created.id}`)
      .auth(token.ownerA, { type: 'bearer' })
      .send({ ...monthly, name: 'Τρίμηνη νέα', durationMonths: 3, priceCents: 11000 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Τρίμηνη νέα', priceCents: 11000 });

    const archived = await request(server())
      .post(`${base(gymA)}/${created.id}/archive`)
      .auth(token.ownerA, { type: 'bearer' });
    expect(archived.status).toBe(204);

    const visible = (await list(token.receptionA)).body as MembershipType[];
    expect(visible.map((t) => t.id)).not.toContain(created.id);
    const all = (await list(token.receptionA, '?includeArchived=true')).body as MembershipType[];
    expect(all.find((t) => t.id === created.id)).toMatchObject({ archived: true });

    const history = await systemDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))
      .orderBy(auditLog.id);
    expect(history.map((h) => h.action)).toEqual([
      'membership_type.created',
      'membership_type.updated',
      'membership_type.archived',
    ]);
  });

  it('answers a type of another gym with 404, and never lists it', async () => {
    const other = (await create(token.ownerB, monthly, gymB)).body as MembershipType;
    const patched = await request(server())
      .patch(`${base(gymA)}/${other.id}`)
      .auth(token.ownerA, { type: 'bearer' })
      .send(monthly);
    expect(patched.status).toBe(404);
    const archived = await request(server())
      .post(`${base(gymA)}/${other.id}/archive`)
      .auth(token.ownerA, { type: 'bearer' });
    expect(archived.status).toBe(404);
    const listed = (await list(token.ownerA, '?includeArchived=true')).body as MembershipType[];
    expect(listed.map((t) => t.id)).not.toContain(other.id);
  });

  it('refuses reception on PATCH and archive, and leaves the type untouched', async () => {
    const created = (await create(token.ownerA)).body as MembershipType;
    const patched = await request(server())
      .patch(`${base(gymA)}/${created.id}`)
      .auth(token.receptionA, { type: 'bearer' })
      .send({ ...monthly, priceCents: 1 });
    expect(patched.status).toBe(403);
    const archived = await request(server())
      .post(`${base(gymA)}/${created.id}/archive`)
      .auth(token.receptionA, { type: 'bearer' });
    expect(archived.status).toBe(403);
    const all = (await list(token.ownerA, '?includeArchived=true')).body as MembershipType[];
    expect(all.find((t) => t.id === created.id)).toMatchObject({
      priceCents: 4000,
      archived: false,
    });
  });

  it("refuses another gym's owner and a platform admin without a role in the gym", async () => {
    expect((await create(token.ownerB, monthly, gymA)).status).toBe(403);
    expect((await list(token.ownerB, '', gymA)).status).toBe(403);
    const admin = signAccessToken({ sub: randomUUID(), adm: true });
    expect((await create(admin)).status).toBe(403);
    expect((await list(admin)).status).toBe(403);
  });

  it('rejects a malformed type id and an invalid PATCH body', async () => {
    const bad = await request(server())
      .patch(`${base(gymA)}/not-a-uuid`)
      .auth(token.ownerA, { type: 'bearer' })
      .send(monthly);
    expect(bad.status).toBe(400);
    const created = (await create(token.ownerA)).body as MembershipType;
    const invalid = await request(server())
      .patch(`${base(gymA)}/${created.id}`)
      .auth(token.ownerA, { type: 'bearer' })
      .send({ ...monthly, durationMonths: 0 });
    expect(invalid.status).toBe(400);
  });

  it('clears the rules that no longer apply when PATCH changes the kind', async () => {
    const created = (await create(token.ownerA)).body as MembershipType;
    const res = await request(server())
      .patch(`${base(gymA)}/${created.id}`)
      .auth(token.ownerA, { type: 'bearer' })
      .send({ name: 'Δεκάρα', kind: 'visits', visitCount: 10, priceCents: 5000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'visits',
      durationMonths: null,
      visitCount: 10,
      maxFreezeDays: 0,
    });
  });

  it('refuses to edit an archived type (404) and records archiving only once', async () => {
    const created = (await create(token.ownerA, { ...monthly, name: 'Παλιά' }))
      .body as MembershipType;
    const archive = () =>
      request(server())
        .post(`${base(gymA)}/${created.id}/archive`)
        .auth(token.ownerA, { type: 'bearer' });
    expect((await archive()).status).toBe(204);
    expect((await archive()).status).toBe(204);

    const patched = await request(server())
      .patch(`${base(gymA)}/${created.id}`)
      .auth(token.ownerA, { type: 'bearer' })
      .send({ ...monthly, name: 'Αλλαγμένη' });
    expect(patched.status).toBe(404);

    const history = await systemDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id));
    expect(history.map((h) => h.action).sort()).toEqual([
      'membership_type.archived',
      'membership_type.created',
    ]);
  });

  it('has no delete route', async () => {
    const created = (await create(token.ownerA)).body as MembershipType;
    const res = await request(server())
      .delete(`${base(gymA)}/${created.id}`)
      .auth(token.ownerA, { type: 'bearer' });
    expect(res.status).toBe(404);
  });
});
