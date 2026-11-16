import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MeResponseSchema } from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { hashToken } from '../src/auth/opaque-token';
import { hashPassword } from '../src/auth/password';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import {
  emailVerifications,
  gymRoles,
  gyms,
  refreshTokens,
  signupCodes,
  users,
} from '../src/db/schema';
import { type MailMessage, MailService } from '../src/mail/mail.service';
import { configureApp } from '../src/main';
import { resetThrottle } from './throttle-reset';

class FakeMail {
  sent: MailMessage[] = [];
  send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    return Promise.resolve();
  }
}

const verifyTokenFrom = (msg: MailMessage | undefined): string => {
  const match = msg?.text.match(/\/verify-email\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no verification link in: ${msg?.text}`);
  return match[1]!;
};

const CODE_DISPLAY = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const GONE = { message: 'Code invalid or expired' };

describe('sign-up codes and member self sign-up', () => {
  const run = randomUUID().slice(0, 8);
  const mail = new FakeMail();
  let app: INestApplication;
  let gymA: string;
  let gymB: string;
  const token = { receptionA: '', receptionB: '', trainerA: '' };
  let existingA: { id: string; email: string; passwordHash: string };

  const server = () => app.getHttpServer();
  let seq = 0;
  const email = () => `m${++seq}-${run}@x.gr`;

  /** Reception creates a code for the gym; returns the displayed code. */
  async function newCode(gym: 'A' | 'B' = 'A'): Promise<string> {
    const gymId = gym === 'A' ? gymA : gymB;
    const bearer = gym === 'A' ? token.receptionA : token.receptionB;
    const res = await request(server())
      .post(`/gyms/${gymId}/signup-codes`)
      .auth(bearer, { type: 'bearer' });
    expect(res.status).toBe(201);
    return (res.body as { code: string }).code;
  }

  const person = (code: string, overrides: Record<string, unknown> = {}) => ({
    code,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    email: email(),
    phone: '69 1234 5678',
    dateOfBirth: '1990-05-17',
    password: 'a long password',
    acceptPrivacy: true,
    ...overrides,
  });

  const signup = (body: Record<string, unknown>) =>
    request(server()).post('/auth/signup').send(body);
  const me = (accessToken: string) =>
    request(server()).get('/auth/me').auth(accessToken, { type: 'bearer' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Signup A ${run}` }, { name: `Signup B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;

    const passwordHash = await hashPassword('existing password');
    const u = await systemDb
      .insert(users)
      .values([
        { email: `rec-a-${run}@x.gr`, firstName: 'Reception', lastName: 'A' },
        { email: `rec-b-${run}@x.gr`, firstName: 'Reception', lastName: 'B' },
        { email: `trainer-${run}@x.gr`, firstName: 'Trainer', lastName: 'A' },
        { email: `existing-${run}@x.gr`, firstName: 'Μαρία', lastName: 'Α', passwordHash },
      ])
      .returning({ id: users.id, email: users.email });
    const [recA, recB, trainer, existing] = u as [
      (typeof u)[0],
      (typeof u)[0],
      (typeof u)[0],
      (typeof u)[0],
    ];
    existingA = { ...existing, passwordHash };
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: recA.id, role: 'reception' },
      { gymId: gymB, userId: recB.id, role: 'reception' },
      { gymId: gymA, userId: trainer.id, role: 'trainer' },
      { gymId: gymA, userId: existing.id, role: 'member' },
    ]);
    token.receptionA = signAccessToken({ sub: recA.id, adm: false });
    token.receptionB = signAccessToken({ sub: recB.id, adm: false });
    token.trainerA = signAccessToken({ sub: trainer.id, adm: false });
  });

  // Many sign-ups from one test IP; the throttle has its own test below.
  beforeEach(() => {
    mail.sent = [];
    resetThrottle(app);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    const ids = systemDb
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    if (gymIds.length) {
      await systemDb.delete(signupCodes).where(inArray(signupCodes.gymId, gymIds));
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(emailVerifications).where(inArray(emailVerifications.userId, ids));
    await systemDb.delete(refreshTokens).where(inArray(refreshTokens.userId, ids));
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  describe('POST /gyms/:gymId/signup-codes', () => {
    it('gives reception a readable code that expires in 24 hours', async () => {
      const before = Date.now();
      const res = await request(server())
        .post(`/gyms/${gymA}/signup-codes`)
        .auth(token.receptionA, { type: 'bearer' });
      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(CODE_DISPLAY);
      const expiresAt = new Date(res.body.expiresAt as string).getTime();
      expect(expiresAt - before).toBeGreaterThan(24 * 3600 * 1000 - 60_000);
      expect(expiresAt - before).toBeLessThanOrEqual(24 * 3600 * 1000 + 60_000);
    });

    it('stores only the hash of the code', async () => {
      const code = await newCode();
      const raw = code.replace('-', '');
      const rows = await systemDb
        .select({ hash: signupCodes.codeHash })
        .from(signupCodes)
        .where(eq(signupCodes.codeHash, hashToken(raw)));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.hash).not.toContain(raw);
    });

    it('refuses reception of another gym with 403 and a malformed gym id with 400', async () => {
      const other = await request(server())
        .post(`/gyms/${gymA}/signup-codes`)
        .auth(token.receptionB, { type: 'bearer' });
      expect(other.status).toBe(403);
      const bad = await request(server())
        .post('/gyms/not-a-uuid/signup-codes')
        .auth(token.receptionA, { type: 'bearer' });
      expect(bad.status).toBe(400);
    });

    it('refuses a trainer with 403', async () => {
      const res = await request(server())
        .post(`/gyms/${gymA}/signup-codes`)
        .auth(token.trainerA, { type: 'bearer' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /auth/signup', () => {
    it('signs up a new member with the code typed in lower case without the dash', async () => {
      const code = await newCode();
      const body = person(code.replace('-', '').toLowerCase());
      const res = await signup(body);
      expect(res.status).toBe(201);
      expect(typeof res.body.accessToken).toBe('string');

      const profile = MeResponseSchema.parse((await me(res.body.accessToken as string)).body);
      expect(profile).toMatchObject({
        email: body.email,
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
        emailVerified: false,
      });
      expect(profile.gyms).toEqual([
        { gymId: gymA, gymName: `Signup A ${run}`, roles: ['member'] },
      ]);

      const [row] = await systemDb
        .select()
        .from(users)
        .where(eq(users.email, body.email as string));
      expect(row).toMatchObject({ phone: '+306912345678', dateOfBirth: '1990-05-17' });

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.to).toBe(body.email);
      verifyTokenFrom(mail.sent[0]);
    });

    it('answers a used, an expired and a made-up code with the same 410', async () => {
      const used = await newCode();
      expect((await signup(person(used))).status).toBe(201);
      const usedAgain = await signup(person(used));

      const expired = await newCode();
      await systemDb
        .update(signupCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(signupCodes.codeHash, hashToken(expired.replace('-', ''))));
      const expiredRes = await signup(person(expired));

      const madeUp = await signup(person('ABCD-EFGH'));

      for (const res of [usedAgain, expiredRes, madeUp]) {
        expect(res.status).toBe(410);
        expect(res.body).toEqual(GONE);
      }
    });

    it('lets exactly one of two simultaneous sign-ups with one code through', async () => {
      const code = await newCode();
      const a = person(code);
      const b = person(code);
      const results = await Promise.all([signup(a), signup(b)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 410]);

      const roles = await systemDb
        .select({ email: users.email })
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(inArray(users.email, [a.email as string, b.email as string]));
      expect(roles).toHaveLength(1);
    });

    it('links an existing account of another gym instead of creating a second one', async () => {
      const code = await newCode('B');
      const res = await signup(
        person(code, { email: existingA.email.toUpperCase(), password: 'some other password' }),
      );
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ signInRequired: true });

      const rows = await systemDb.select().from(users).where(eq(users.email, existingA.email));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.passwordHash).toBe(existingA.passwordHash);
      // Details typed at sign-up don't overwrite the existing account.
      expect(rows[0]!.firstName).toBe('Μαρία');

      const login = await request(server())
        .post('/auth/login')
        .send({ email: existingA.email, password: 'existing password' });
      const profile = MeResponseSchema.parse((await me(login.body.accessToken as string)).body);
      expect(profile.gyms.map((g) => g.gymId).sort()).toEqual([gymA, gymB].sort());
      expect(mail.sent).toHaveLength(0);
    });

    it('answers an existing member of the gym with 409 and leaves the code usable', async () => {
      const code = await newCode();
      const res = await signup(person(code, { email: existingA.email }));
      expect(res.status).toBe(409);

      const [row] = await systemDb
        .select({ usedAt: signupCodes.usedAt })
        .from(signupCodes)
        .where(eq(signupCodes.codeHash, hashToken(code.replace('-', ''))));
      expect(row?.usedAt).toBeNull();
      expect((await signup(person(code))).status).toBe(201);
    });

    it('rejects a missing privacy acceptance and a birth date in the future with 400', async () => {
      const code = await newCode();
      const tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
      expect((await signup(person(code, { acceptPrivacy: false }))).status).toBe(400);
      expect((await signup(person(code, { dateOfBirth: tomorrow }))).status).toBe(400);
      expect((await signup(person(code, { phone: '' }))).status).toBe(400);
      expect((await signup(person(code, { password: 'seven77' }))).status).toBe(400);
      // None of the rejected attempts used the code up.
      expect((await signup(person(code))).status).toBe(201);
    });

    it('answers the 11th sign-up attempt from one IP within 60 s with 429', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await signup(person('ABCD-EFGH'))).status).toBe(410);
      }
      expect((await signup(person('ABCD-EFGH'))).status).toBe(429);
    });
  });

  describe('email confirmation', () => {
    it('confirms the email once; the same link again gives 410', async () => {
      const code = await newCode();
      const res = await signup(person(code));
      const accessToken = res.body.accessToken as string;
      const verifyToken = verifyTokenFrom(mail.sent[0]);

      const first = await request(server()).post('/auth/verify-email').send({ token: verifyToken });
      expect(first.status).toBe(204);
      expect(MeResponseSchema.parse((await me(accessToken)).body).emailVerified).toBe(true);

      const again = await request(server()).post('/auth/verify-email').send({ token: verifyToken });
      expect(again.status).toBe(410);
    });

    it('rejects an expired link with 410 and leaves the email unconfirmed', async () => {
      const code = await newCode();
      const res = await signup(person(code));
      const verifyToken = verifyTokenFrom(mail.sent[0]);
      await systemDb
        .update(emailVerifications)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(emailVerifications.tokenHash, hashToken(verifyToken)));

      const verify = await request(server())
        .post('/auth/verify-email')
        .send({ token: verifyToken });
      expect(verify.status).toBe(410);
      const profile = MeResponseSchema.parse((await me(res.body.accessToken as string)).body);
      expect(profile.emailVerified).toBe(false);
    });

    it('resending sends a new link and makes the earlier one useless', async () => {
      const code = await newCode();
      const res = await signup(person(code));
      const accessToken = res.body.accessToken as string;
      const oldToken = verifyTokenFrom(mail.sent[0]);

      const resend = await request(server())
        .post('/auth/resend-verification')
        .auth(accessToken, { type: 'bearer' });
      expect(resend.status).toBe(204);
      expect(mail.sent).toHaveLength(2);
      const newToken = verifyTokenFrom(mail.sent[1]);
      expect(newToken).not.toBe(oldToken);

      expect(
        (await request(server()).post('/auth/verify-email').send({ token: oldToken })).status,
      ).toBe(410);
      expect(
        (await request(server()).post('/auth/verify-email').send({ token: newToken })).status,
      ).toBe(204);
    });

    it('answers the 11th resend from one IP within 60 s with 429', async () => {
      const res = await signup(person(await newCode()));
      const accessToken = res.body.accessToken as string;
      resetThrottle(app);
      const resend = () =>
        request(server()).post('/auth/resend-verification').auth(accessToken, { type: 'bearer' });
      for (let i = 0; i < 10; i++) expect((await resend()).status).toBe(204);
      expect((await resend()).status).toBe(429);
    });

    it('requires sign-in to resend', async () => {
      expect((await request(server()).post('/auth/resend-verification')).status).toBe(401);
    });
  });
});
