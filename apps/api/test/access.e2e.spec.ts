import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CurrentGym, type GymContext } from '../src/access/gym-context';
import { GymRoles, PlatformAdmin } from '../src/access/roles.decorator';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { getEnv } from '../src/config/env';
import { systemDb } from '../src/db/client';
import { gymRoles, gyms, users } from '../src/db/schema';
import { createApp } from '../src/main';

/** Test-only routes, one per kind of guard. */
@Controller()
class AccessProbeController {
  @Get('gyms/:gymId/_owner')
  @GymRoles('owner')
  owner(@CurrentGym() gym: GymContext): GymContext {
    return gym;
  }

  @Get('gyms/:gymId/_desk')
  @GymRoles('reception')
  desk(@CurrentGym() gym: GymContext): GymContext {
    return gym;
  }

  @Get('platform/_ping')
  @PlatformAdmin()
  ping(): { ok: true } {
    return { ok: true };
  }
}

@Module({ imports: [AppModule], controllers: [AccessProbeController] })
class AccessProbeModule {}

describe('access control', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymA: string;
  let gymB: string;
  const token: Record<
    'ownerA' | 'memberA' | 'admin' | 'staleAdmin' | 'receptionA' | 'dual',
    string
  > = {
    receptionA: '',
    dual: '',
    ownerA: '',
    memberA: '',
    admin: '',
    staleAdmin: '',
  };

  const get = (path: string, bearer?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return bearer ? req.auth(bearer, { type: 'bearer' }) : req;
  };

  beforeAll(async () => {
    app = await createApp(AccessProbeModule);
    await app.init();

    const g = await systemDb
      .insert(gyms)
      .values([{ name: `A ${run}` }, { name: `B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;

    const u = await systemDb
      .insert(users)
      .values([
        { email: `owner-${run}@x.gr`, firstName: 'Owner', lastName: 'A' },
        { email: `member-${run}@x.gr`, firstName: 'Member', lastName: 'A' },
        { email: `admin-${run}@x.gr`, firstName: 'Admin', lastName: 'Test', isPlatformAdmin: true },
        { email: `former-admin-${run}@x.gr`, firstName: 'Former', lastName: 'admin' },
        { email: `reception-${run}@x.gr`, firstName: 'Reception', lastName: 'A' },
        { email: `dual-${run}@x.gr`, firstName: 'Dual', lastName: 'Test' },
      ])
      .returning({ id: users.id });
    const [owner, member, admin, former, reception, dual] = u.map((r) => r.id) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: owner, role: 'owner' },
      { gymId: gymA, userId: member, role: 'member' },
      { gymId: gymA, userId: reception, role: 'reception' },
      { gymId: gymA, userId: dual, role: 'member' },
      { gymId: gymB, userId: dual, role: 'owner' },
    ]);
    token.receptionA = signAccessToken({ sub: reception, adm: false });
    token.dual = signAccessToken({ sub: dual, adm: false });

    token.ownerA = signAccessToken({ sub: owner, adm: false });
    token.memberA = signAccessToken({ sub: member, adm: false });
    token.admin = signAccessToken({ sub: admin, adm: true });
    // Issued while still an admin; the database says otherwise now.
    token.staleAdmin = signAccessToken({ sub: former, adm: true });
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  describe('gym roles', () => {
    it('rejects a member of gym A on an owner route with 403', async () => {
      expect((await get(`/gyms/${gymA}/_owner`, token.memberA)).status).toBe(403);
    });

    it('lets the owner of gym A through an owner route, with the gym context', async () => {
      const res = await get(`/gyms/${gymA}/_owner`, token.ownerA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: gymA, roles: ['owner'] });
    });

    it('normalises an upper-case gym id to the stored lower-case form', async () => {
      const res = await get(`/gyms/${gymA.toUpperCase()}/_owner`, token.ownerA);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(gymA);
    });

    it('lets the owner of gym A through a reception route (owner covers reception)', async () => {
      expect((await get(`/gyms/${gymA}/_desk`, token.ownerA)).status).toBe(200);
    });

    it('rejects a member on a reception route with 403', async () => {
      expect((await get(`/gyms/${gymA}/_desk`, token.memberA)).status).toBe(403);
    });

    it('rejects the owner of gym A on gym B with 403', async () => {
      expect((await get(`/gyms/${gymB}/_owner`, token.ownerA)).status).toBe(403);
    });

    it('rejects a gym that does not exist with 403', async () => {
      expect((await get(`/gyms/${randomUUID()}/_owner`, token.ownerA)).status).toBe(403);
    });

    it('rejects a malformed gym id with 400, not 500', async () => {
      expect((await get('/gyms/not-a-uuid/_owner', token.ownerA)).status).toBe(400);
    });

    it('rejects a request without a token with 401', async () => {
      expect((await get(`/gyms/${gymA}/_owner`)).status).toBe(401);
    });

    it('rejects a garbage, expired or wrongly signed token with 401', async () => {
      const sub = randomUUID();
      const expired = jwt.sign({ adm: false }, getEnv().JWT_SECRET, {
        algorithm: 'HS256',
        subject: sub,
        expiresIn: -60,
      });
      const forged = jwt.sign({ adm: false }, 'not-the-server-secret', {
        algorithm: 'HS256',
        subject: sub,
        expiresIn: 60,
      });
      for (const bad of ['garbage', expired, forged]) {
        expect((await get(`/gyms/${gymA}/_owner`, bad)).status).toBe(401);
      }
    });

    it('rejects a reception-only user on an owner route but lets them on a reception route', async () => {
      expect((await get(`/gyms/${gymA}/_owner`, token.receptionA)).status).toBe(403);
      const res = await get(`/gyms/${gymA}/_desk`, token.receptionA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: gymA, roles: ['reception'] });
    });

    it('does not let a role held in gym B count in gym A (user in two gyms)', async () => {
      // dualUser: member of A, owner of B.
      expect((await get(`/gyms/${gymA}/_owner`, token.dual)).status).toBe(403);
      expect((await get(`/gyms/${gymA}/_desk`, token.dual)).status).toBe(403);
      const res = await get(`/gyms/${gymB}/_owner`, token.dual);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: gymB, roles: ['owner'] });
    });
  });

  describe('platform admin', () => {
    it('lets the platform admin through a platform route', async () => {
      expect((await get('/platform/_ping', token.admin)).status).toBe(200);
    });

    it('gives the platform admin no implicit access to gym routes', async () => {
      expect((await get(`/gyms/${gymA}/_owner`, token.admin)).status).toBe(403);
      expect((await get(`/gyms/${gymA}/_desk`, token.admin)).status).toBe(403);
    });

    it('rejects a gym owner on a platform route with 403', async () => {
      expect((await get('/platform/_ping', token.ownerA)).status).toBe(403);
    });

    it('rejects a token whose admin claim the database no longer backs with 403', async () => {
      expect((await get('/platform/_ping', token.staleAdmin)).status).toBe(403);
    });

    it('rejects a request without a token with 401', async () => {
      expect((await get('/platform/_ping')).status).toBe(401);
    });
  });
});
