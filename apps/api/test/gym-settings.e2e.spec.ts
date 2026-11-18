import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { verifyCheckInToken } from '../src/checkin/checkin-token';
import { systemDb } from '../src/db/client';
import { auditLog, gymRoles, gyms, users } from '../src/db/schema';
import { configureApp } from '../src/main';

describe('gym settings and member check-in token', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  let memberId: string;
  let tokens: { owner: string; reception: string; trainer: string; member: string };

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Settings ${run}`, timezone: 'Europe/Athens' })
      .returning({ id: gyms.id });
    gymId = g!.id;
    const [g2] = await systemDb
      .insert(gyms)
      .values({ name: `Other ${run}`, timezone: 'Europe/Athens' })
      .returning({ id: gyms.id });
    otherGymId = g2!.id;
    const u = await systemDb
      .insert(users)
      .values(
        ['owner', 'rec', 'trainer', 'mem'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'Test',
        })),
      )
      .returning({ id: users.id });
    memberId = u[3]!.id;
    await systemDb.insert(gymRoles).values([
      { gymId, userId: u[0]!.id, role: 'owner' },
      { gymId, userId: u[1]!.id, role: 'reception' },
      { gymId, userId: u[2]!.id, role: 'trainer' },
      { gymId, userId: memberId, role: 'member' },
    ]);
    const sign = (id: string) => signAccessToken({ sub: id, adm: false });
    tokens = {
      owner: sign(u[0]!.id),
      reception: sign(u[1]!.id),
      trainer: sign(u[2]!.id),
      member: sign(memberId),
    };
  });

  afterAll(async () => {
    if (gymId) {
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, gymId));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
      await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    }
    if (otherGymId) await systemDb.delete(gyms).where(eq(gyms.id, otherGymId));
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('gives a member a token for their own member id and gym; a trainer gets 403', async () => {
    const res = await request(server())
      .get(`/gyms/${gymId}/me/check-in-token`)
      .auth(tokens.member, { type: 'bearer' })
      .expect(200);
    const body = res.body as { token: string; expiresAt: string };
    expect(verifyCheckInToken(body.token, new Date())).toEqual({ memberId, gymId });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    await request(server())
      .get(`/gyms/${gymId}/me/check-in-token`)
      .auth(tokens.trainer, { type: 'bearer' })
      .expect(403);
  });

  it('keeps one gym out of another: no token or settings across gyms, and non-owners cannot patch', async () => {
    // Owner and member of gym A act on gym B (where they hold no role).
    await request(server())
      .get(`/gyms/${otherGymId}/me/check-in-token`)
      .auth(tokens.member, { type: 'bearer' })
      .expect(403);
    await request(server())
      .get(`/gyms/${otherGymId}/settings`)
      .auth(tokens.owner, { type: 'bearer' })
      .expect(403);
    await request(server())
      .patch(`/gyms/${otherGymId}/settings`)
      .auth(tokens.owner, { type: 'bearer' })
      .send({ autoCheckoutMinutes: 45 })
      .expect(403);
    await request(server())
      .patch(`/gyms/${gymId}/settings`)
      .auth(tokens.trainer, { type: 'bearer' })
      .send({ autoCheckoutMinutes: 45 })
      .expect(403);
    await request(server()).get(`/gyms/${gymId}/settings`).expect(401);
    const [other] = await systemDb
      .select({ m: gyms.autoCheckoutMinutes })
      .from(gyms)
      .where(eq(gyms.id, otherGymId));
    expect(other!.m).toBe(120);
  });

  it('lets reception read the settings (auto check-out 120) but not change them', async () => {
    const res = await request(server())
      .get(`/gyms/${gymId}/settings`)
      .auth(tokens.reception, { type: 'bearer' })
      .expect(200);
    expect(res.body).toEqual({
      name: `Settings ${run}`,
      timezone: 'Europe/Athens',
      autoCheckoutMinutes: 120,
      receptionCanEditShifts: false,
      reminderDays: 5,
      capacity: null,
      showOccupancyCount: false,
    });
    await request(server())
      .patch(`/gyms/${gymId}/settings`)
      .auth(tokens.reception, { type: 'bearer' })
      .send({ autoCheckoutMinutes: 90 })
      .expect(403);
  });

  it('rejects 20, 601 and "90", accepts 30 then 90, and writes one history row per change', async () => {
    const patch = (n: unknown) =>
      request(server())
        .patch(`/gyms/${gymId}/settings`)
        .auth(tokens.owner, { type: 'bearer' })
        .send({ autoCheckoutMinutes: n });
    await patch(20).expect(400);
    await patch(29).expect(400);
    await patch(601).expect(400);
    await patch(90.5).expect(400);
    await patch('90').expect(400);
    await patch(600).expect(200); // upper bound is inclusive
    await patch(30).expect(200); // lower bound is inclusive
    const res = await patch(90).expect(200);
    expect(res.body).toMatchObject({ autoCheckoutMinutes: 90 });

    const rows = await systemDb.select().from(auditLog).where(eq(auditLog.gymId, gymId));
    const changes = rows
      .filter((r) => r.action === 'gym.settings_updated')
      .sort((a, b) => Number(a.id) - Number(b.id));
    // Only the three accepted changes are recorded; the five rejected ones are not.
    expect(changes).toHaveLength(3);
    expect(changes[0]!.data).toMatchObject({ from: 120, to: 600 });
    expect(changes[1]!.data).toMatchObject({ from: 600, to: 30 });
    expect(changes[2]!.data).toMatchObject({ from: 30, to: 90 });

    // The other gym keeps its own value.
    const [other] = await systemDb
      .select({ m: gyms.autoCheckoutMinutes })
      .from(gyms)
      .where(eq(gyms.id, otherGymId));
    expect(other!.m).toBe(120);

    const after = await request(server())
      .get(`/gyms/${gymId}/settings`)
      .auth(tokens.reception, { type: 'bearer' });
    expect((after.body as { autoCheckoutMinutes: number }).autoCheckoutMinutes).toBe(90);
  });

  it('the owner sets the reminder lead time between 1 and 14 days; 0, 15 and "7" are refused', async () => {
    const patch = (n: unknown) =>
      request(server())
        .patch(`/gyms/${gymId}/settings`)
        .auth(tokens.owner, { type: 'bearer' })
        .send({ reminderDays: n });
    for (const bad of [0, 15, 7.5, '7']) await patch(bad).expect(400);
    await patch(14).expect(200);
    await patch(1).expect(200);
    expect((await patch(7).expect(200)).body).toMatchObject({ reminderDays: 7 });
    const rows = await systemDb.select().from(auditLog).where(eq(auditLog.gymId, gymId));
    const history = rows.filter(
      (r) =>
        r.action === 'gym.settings_updated' &&
        (r.data as { setting?: string } | null)?.setting === 'reminderDays',
    );
    expect(history.map((r) => (r.data as { to: number }).to).sort((a, b) => a - b)).toEqual([
      1, 7, 14,
    ]);
    await request(server())
      .patch(`/gyms/${gymId}/settings`)
      .auth(tokens.reception, { type: 'bearer' })
      .send({ reminderDays: 3 })
      .expect(403);
    // Neither the refused values nor reception's attempt changed the stored setting.
    const after = await request(server())
      .get(`/gyms/${gymId}/settings`)
      .auth(tokens.owner, { type: 'bearer' })
      .expect(200);
    expect(after.body).toMatchObject({ reminderDays: 7 });
  });
});
