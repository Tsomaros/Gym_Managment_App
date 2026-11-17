import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  devicePairingCodes,
  devices,
  gymRoles,
  gyms,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';
import { resetThrottle } from './throttle-reset';

interface Paired {
  deviceToken: string;
  gymId: string;
  gymName: string;
  deviceName: string;
}

describe('kiosk devices', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  let owner: string;
  let reception: string;
  let otherOwner: string;
  let memberToken: string;

  const server = () => app.getHttpServer();
  const createCode = (token: string, gym = gymId, name = 'Είσοδος') =>
    request(server())
      .post(`/gyms/${gym}/devices/pairing-codes`)
      .auth(token, { type: 'bearer' })
      .send({ name });
  const pair = (code: string) => request(server()).post('/kiosk/pair').send({ code });
  const me = (deviceToken: string) =>
    request(server()).get('/kiosk/me').set('Authorization', `Device ${deviceToken}`);
  /** Owner creates a code and a tablet pairs with it. */
  async function pairedDevice(name = 'Είσοδος'): Promise<Paired> {
    const code = (await createCode(owner, gymId, name).expect(201)).body as { code: string };
    return (await pair(code.code).expect(201)).body as Paired;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Devices A ${run}` }, { name: `Devices B ${run}` }])
      .returning({ id: gyms.id });
    gymId = g[0]!.id;
    otherGymId = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values(
        ['owner', 'rec', 'oowner', 'mem'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'Test',
        })),
      )
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId, userId: u[0]!.id, role: 'owner' },
      { gymId, userId: u[1]!.id, role: 'reception' },
      { gymId: otherGymId, userId: u[2]!.id, role: 'owner' },
      { gymId, userId: u[3]!.id, role: 'member' },
    ]);
    const sign = (id: string) => signAccessToken({ sub: id, adm: false });
    owner = sign(u[0]!.id);
    reception = sign(u[1]!.id);
    otherOwner = sign(u[2]!.id);
    memberToken = sign(u[3]!.id);
  });

  // Several tests pair a tablet; the per-IP limit is tested on its own at the end.
  beforeEach(() => resetThrottle(app));

  afterAll(async () => {
    const ids = [gymId, otherGymId].filter(Boolean);
    for (const id of ids) {
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, id));
      await systemDb.delete(devices).where(eq(devices.gymId, id));
      await systemDb.delete(devicePairingCodes).where(eq(devicePairingCodes.gymId, id));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, id));
      await systemDb.delete(gyms).where(eq(gyms.id, id));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('pairs with a lower-case code, then /kiosk/me names the gym and the device', async () => {
    const created = (await createCode(owner, gymId, 'Πόρτα').expect(201)).body as {
      code: string;
      expiresAt: string;
    };
    expect(created.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const minutes = (new Date(created.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const paired = (await pair(created.code.toLowerCase()).expect(201)).body as Paired;
    expect(paired).toMatchObject({ gymId, gymName: `Devices A ${run}`, deviceName: 'Πόρτα' });
    expect(paired.deviceToken.length).toBeGreaterThanOrEqual(43);

    const res = await me(paired.deviceToken).expect(200);
    expect(res.body).toEqual({ gymId, gymName: `Devices A ${run}`, deviceName: 'Πόρτα' });
  });

  it('stores only the hash of the device token and of the pairing code', async () => {
    const code = (await createCode(owner).expect(201)).body as { code: string };
    const paired = (await pair(code.code).expect(201)).body as Paired;
    const rows = await systemDb.select().from(devices).where(eq(devices.gymId, gymId));
    // Independent expectation: sha256 hex of the raw value (computed here, not by the app's helper).
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(rows.map((r) => r.tokenHash)).toContain(sha(paired.deviceToken));
    expect(rows.some((r) => r.tokenHash === paired.deviceToken)).toBe(false);
    const codes = await systemDb
      .select()
      .from(devicePairingCodes)
      .where(eq(devicePairingCodes.gymId, gymId));
    expect(codes.map((c) => c.codeHash)).toContain(sha(code.code.replace('-', '')));
    expect(codes.some((c) => c.codeHash === code.code.replace('-', ''))).toBe(false);
  });

  it('two tablets racing for one code: exactly one pairs, the other gets 410', async () => {
    const code = (await createCode(owner, gymId, 'Race').expect(201)).body as { code: string };
    const results = await Promise.all([pair(code.code), pair(code.code)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
    const rows = await systemDb.select().from(devices).where(eq(devices.gymId, gymId));
    expect(rows.filter((r) => r.name === 'Race')).toHaveLength(1);
  });

  it("another gym's owner cannot create codes for, list or revoke in this gym (403)", async () => {
    const paired = await pairedDevice('Μόνο δικό μας');
    await createCode(otherOwner, gymId).expect(403);
    await request(server())
      .get(`/gyms/${gymId}/devices`)
      .auth(otherOwner, { type: 'bearer' })
      .expect(403);
    const list = (
      await request(server())
        .get(`/gyms/${otherGymId}/devices`)
        .auth(otherOwner, { type: 'bearer' })
        .expect(200)
    ).body as { name: string }[];
    expect(list.map((d) => d.name)).not.toContain('Μόνο δικό μας');
    await me(paired.deviceToken).expect(200);
  });

  it('revoke answers 404 for an unknown device, 400 for a malformed id, and is idempotent', async () => {
    const revoke = (id: string) =>
      request(server()).post(`/gyms/${gymId}/devices/${id}/revoke`).auth(owner, { type: 'bearer' });
    await revoke(randomUUID()).expect(404);
    await revoke('not-a-uuid').expect(400);

    const paired = await pairedDevice('Διπλή ανάκληση');
    const [row] = (await systemDb.select().from(devices).where(eq(devices.gymId, gymId))).filter(
      (r) => r.name === 'Διπλή ανάκληση',
    );
    await revoke(row!.id).expect(204);
    await revoke(row!.id).expect(204);
    await me(paired.deviceToken).expect(401);
    const history = await systemDb.select().from(auditLog).where(eq(auditLog.entityId, row!.id));
    expect(history.filter((h) => h.action === 'device.revoked')).toHaveLength(1);
  });

  it('answers 410 for a code used twice, an expired code, an unknown code and a malformed one', async () => {
    const code = (await createCode(owner).expect(201)).body as { code: string };
    await pair(code.code).expect(201);
    await pair(code.code).expect(410);

    const old = (await createCode(owner).expect(201)).body as { code: string };
    await systemDb
      .update(devicePairingCodes)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(devicePairingCodes.gymId, gymId));
    await pair(old.code).expect(410);

    await pair('ZZZZ-ZZZZ').expect(410);
    await pair('nope').expect(410);
  });

  it('lets only the owner create pairing codes and list devices', async () => {
    await createCode(reception).expect(403);
    await createCode(memberToken).expect(403);
    await request(server())
      .get(`/gyms/${gymId}/devices`)
      .auth(reception, { type: 'bearer' })
      .expect(403);
    await createCode(owner, gymId, '').expect(400);
    await createCode(owner, gymId, 'x'.repeat(61)).expect(400);
  });

  it('lists devices with last seen and revoked state, and records pairing in the history', async () => {
    const paired = await pairedDevice('Λίστα');
    await me(paired.deviceToken).expect(200);
    const list = (
      await request(server())
        .get(`/gyms/${gymId}/devices`)
        .auth(owner, { type: 'bearer' })
        .expect(200)
    ).body as { id: string; name: string; revoked: boolean; lastSeenAt: string | null }[];
    const mine = list.find((d) => d.name === 'Λίστα')!;
    expect(mine).toMatchObject({ revoked: false });
    expect(mine.lastSeenAt).not.toBeNull();
    expect(JSON.stringify(list)).not.toContain(paired.deviceToken);

    const history = await systemDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, mine.id));
    expect(history.map((h) => h.action)).toContain('device.paired');
  });

  it('answers 401 on the very next request after the owner revokes the tablet', async () => {
    const paired = await pairedDevice('Ανακλήθηκε');
    await me(paired.deviceToken).expect(200);
    const [row] = await systemDb
      .select()
      .from(devices)
      .where(eq(devices.gymId, gymId))
      .then((rs) => rs.filter((r) => r.name === 'Ανακλήθηκε'));

    await request(server())
      .post(`/gyms/${gymId}/devices/${row!.id}/revoke`)
      .auth(reception, { type: 'bearer' })
      .expect(403);
    await me(paired.deviceToken).expect(200);

    await request(server())
      .post(`/gyms/${gymId}/devices/${row!.id}/revoke`)
      .auth(owner, { type: 'bearer' })
      .expect(204);
    await me(paired.deviceToken).expect(401);

    const history = await systemDb.select().from(auditLog).where(eq(auditLog.entityId, row!.id));
    expect(history.map((h) => h.action)).toContain('device.revoked');
  });

  it("cannot revoke another gym's device: 404, and the tablet keeps working", async () => {
    const paired = await pairedDevice('Ξένο');
    const [row] = await systemDb
      .select()
      .from(devices)
      .where(eq(devices.gymId, gymId))
      .then((rs) => rs.filter((r) => r.name === 'Ξένο'));
    await request(server())
      .post(`/gyms/${otherGymId}/devices/${row!.id}/revoke`)
      .auth(otherOwner, { type: 'bearer' })
      .expect(404);
    await me(paired.deviceToken).expect(200);
  });

  it('rejects a user token on /kiosk/me, no token, a garbage token, and a device token on a gym route', async () => {
    await request(server()).get('/kiosk/me').auth(owner, { type: 'bearer' }).expect(401);
    await request(server()).get('/kiosk/me').expect(401);
    await me('garbage').expect(401);
    const paired = await pairedDevice();
    await request(server())
      .get(`/gyms/${gymId}/settings`)
      .set('Authorization', `Device ${paired.deviceToken}`)
      .expect(401);
  });

  it('answers 429 to the 11th pairing attempt from one IP within 60 s', async () => {
    resetThrottle(app);
    for (let i = 0; i < 10; i++) await pair('ZZZZ-ZZZZ').expect(410);
    await pair('ZZZZ-ZZZZ').expect(429);
  });
});
