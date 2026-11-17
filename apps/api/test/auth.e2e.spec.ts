import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MeResponseSchema } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { getEnv } from '../src/config/env';
import { systemDb } from '../src/db/client';
import { gymRoles, gyms, refreshTokens, users } from '../src/db/schema';
import { createApp } from '../src/main';
import { seedPlatformAdmin } from '../src/seed';
import { resetThrottle } from './throttle-reset';

const PASSWORD = 'correct horse battery';

/** The `gym_rt` cookie from a response: its value and its attribute string. */
function refreshCookie(res: request.Response): { value: string; header: string } {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const header = raw?.find((c) => c.startsWith('gym_rt='));
  if (!header) throw new Error('response has no gym_rt cookie');
  return { value: header.split(';')[0]!.slice('gym_rt='.length), header };
}

describe('auth', () => {
  const run = randomUUID().slice(0, 8);
  const adminEmail = `admin-${run}@x.gr`;
  const memberEmail = `member-${run}@x.gr`;
  let app: INestApplication;
  let gymId: string;

  const login = (email: string, password = PASSWORD) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });
  const refresh = (cookie: string) =>
    request(app.getHttpServer()).post('/auth/refresh').set('Cookie', `gym_rt=${cookie}`);

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await seedPlatformAdmin(adminEmail, PASSWORD);

    // A member with a role in one gym, for /auth/me memberships.
    const [gym] = await systemDb
      .insert(gyms)
      .values({ name: `Γυμναστήριο ${run}` })
      .returning({ id: gyms.id });
    gymId = gym!.id;
    const [member] = await systemDb
      .insert(users)
      .values({
        email: memberEmail,
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
        passwordHash: await hashPassword(PASSWORD),
        isPlatformAdmin: false,
      })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId, userId: member!.id, role: 'member' },
      { gymId, userId: member!.id, role: 'trainer' },
    ]);
  });

  // This suite signs in as one account more often than the login limit allows a person to.
  beforeEach(() => resetThrottle(app));

  afterAll(async () => {
    const emails = sql`${users.email} like ${`%-${run}@x.gr`}`;
    const ids = systemDb.select({ id: users.id }).from(users).where(emails);
    await systemDb.delete(gymRoles).where(sql`${gymRoles.userId} in ${ids}`);
    await systemDb.delete(refreshTokens).where(sql`${refreshTokens.userId} in ${ids}`);
    await systemDb.delete(users).where(emails);
    if (gymId) await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    await app?.close();
  });

  describe('POST /auth/login', () => {
    it('answers a wrong password and an unknown email with the same 401 body', async () => {
      const wrongPassword = await login(adminEmail, 'not the password');
      const unknownEmail = await login(`nobody-${run}@x.gr`);

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual({ message: 'Invalid credentials' });
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('accepts the email with different casing and surrounding spaces', async () => {
      const res = await login(`  ${adminEmail.toUpperCase()} `);
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
    });

    it('sets gym_rt as HttpOnly, Secure, SameSite=Strict on path /auth', async () => {
      const { header } = refreshCookie(await login(adminEmail));
      expect(header).toMatch(/;\s*HttpOnly/i);
      expect(header).toMatch(/;\s*Secure/i);
      expect(header).toMatch(/;\s*SameSite=Strict/i);
      expect(header).toMatch(/;\s*Path=\/auth(;|$)/i);
    });

    it('rejects a malformed body with 400', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email: 'nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns a new access token and a different cookie', async () => {
      const first = refreshCookie(await login(adminEmail));
      const res = await refresh(first.value);

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(refreshCookie(res).value).not.toBe(first.value);
    });

    it('treats reuse of a rotated cookie as theft: 401, and the newer cookie dies too', async () => {
      const old = refreshCookie(await login(adminEmail)).value;
      const newer = refreshCookie(await refresh(old)).value;

      expect((await refresh(old)).status).toBe(401);
      expect((await refresh(newer)).status).toBe(401);
    });

    it('rejects a cookie whose row is past expires_at, even though it was never used', async () => {
      const cookie = refreshCookie(await login(adminEmail)).value;
      // Tokens are stored as sha256 hex of the raw value (spec: opaque, hashed refresh tokens).
      const tokenHash = createHash('sha256').update(cookie).digest('hex');
      const expired = await systemDb
        .update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .returning({ id: refreshTokens.id });
      expect(expired).toHaveLength(1);

      expect((await refresh(cookie)).status).toBe(401);
    });

    it('lets exactly one of two simultaneous refreshes with the same cookie succeed', async () => {
      const cookie = refreshCookie(await login(adminEmail)).value;
      const results = await Promise.all([refresh(cookie), refresh(cookie)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('rejects a missing or unknown cookie with 401', async () => {
      expect((await request(app.getHttpServer()).post('/auth/refresh')).status).toBe(401);
      expect((await refresh('not-a-real-token')).status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 204, clears the cookie, and the cookie no longer refreshes', async () => {
      const cookie = refreshCookie(await login(adminEmail)).value;
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `gym_rt=${cookie}`);

      expect(res.status).toBe(204);
      expect(refreshCookie(res).header).toMatch(/gym_rt=;/);
      expect((await refresh(cookie)).status).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('rejects a request without a valid Bearer token with 401', async () => {
      const server = app.getHttpServer();
      expect((await request(server).get('/auth/me')).status).toBe(401);
      expect(
        (await request(server).get('/auth/me').auth('garbage', { type: 'bearer' })).status,
      ).toBe(401);
    });

    it('rejects an expired token, a token signed with another secret and an unsigned token', async () => {
      const server = app.getHttpServer();
      const { accessToken } = (await login(adminEmail)).body as { accessToken: string };
      const sub = (jwt.decode(accessToken) as { sub: string }).sub;
      const secret = getEnv().JWT_SECRET;
      const me = (t: string) => request(server).get('/auth/me').auth(t, { type: 'bearer' });

      // Control: same claims, right secret, still valid -> proves the failures below are about the token.
      expect(
        (await me(jwt.sign({ adm: true }, secret, { subject: sub, expiresIn: 60 }))).status,
      ).toBe(200);

      const expired = jwt.sign({ adm: true }, secret, { subject: sub, expiresIn: -10 });
      const wrongSecret = jwt.sign({ adm: true }, 'y'.repeat(32), { subject: sub, expiresIn: 60 });
      const unsigned = jwt.sign({ adm: true }, '', { subject: sub, algorithm: 'none' });
      expect((await me(expired)).status).toBe(401);
      expect((await me(wrongSecret)).status).toBe(401);
      expect((await me(unsigned)).status).toBe(401);
    });

    it('issues an access token that lives about 15 minutes', async () => {
      const { accessToken } = (await login(adminEmail)).body as { accessToken: string };
      const { iat, exp } = jwt.decode(accessToken) as { iat: number; exp: number };
      expect(exp - iat).toBe(15 * 60); // spec: 15-minute access token
    });

    it('returns the platform admin with no gyms', async () => {
      const { accessToken } = (await login(adminEmail)).body as { accessToken: string };
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .auth(accessToken, { type: 'bearer' });

      expect(res.status).toBe(200);
      const me = MeResponseSchema.parse(res.body);
      expect(me).toMatchObject({ email: adminEmail, isPlatformAdmin: true, gyms: [] });
    });

    it('returns a member with each gym and all their roles there, Greek text intact', async () => {
      const { accessToken } = (await login(memberEmail)).body as { accessToken: string };
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .auth(accessToken, { type: 'bearer' });

      const me = MeResponseSchema.parse(res.body);
      expect(me.isPlatformAdmin).toBe(false);
      expect(me.fullName).toBe('Γιώργος Παπαδόπουλος');
      // Seeded directly, never confirmed by email.
      expect(me).toMatchObject({
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
        emailVerified: false,
      });
      expect(me.gyms).toHaveLength(1);
      expect(me.gyms[0]).toMatchObject({ gymId, gymName: `Γυμναστήριο ${run}` });
      expect([...me.gyms[0]!.roles].sort()).toEqual(['member', 'trainer']);
    });
  });
});
