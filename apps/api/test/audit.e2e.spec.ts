import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignupService } from '../src/signup/signup.service';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import {
  auditLog,
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

interface Entry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actor: { id: string; fullName: string } | null;
  data: Record<string, unknown>;
  at: string;
}

describe('change history', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymId: string;
  let receptionId: string;
  const token = { owner: '', reception: '' };

  const server = () => app.getHttpServer();
  const history = (bearer: string, query = '') =>
    request(server()).get(`/gyms/${gymId}/audit${query}`).auth(bearer, { type: 'bearer' });
  const newCode = async () => {
    const res = await request(server())
      .post(`/gyms/${gymId}/signup-codes`)
      .auth(token.reception, { type: 'bearer' });
    expect(res.status).toBe(201);
    return res.body.code as string;
  };
  const signup = (code: string, email: string) =>
    request(server()).post('/auth/signup').send({
      code,
      firstName: 'Νέο',
      lastName: 'Μέλος',
      email,
      phone: '6912345678',
      dateOfBirth: '1995-01-01',
      password: 'secret password 1',
      acceptPrivacy: true,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(new FakeMail())
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Audit ${run}` })
      .returning({ id: gyms.id });
    gymId = g!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `owner-${run}@x.gr`, firstName: 'Νίκος', lastName: 'Ιδιοκτήτης' },
        { email: `rec-${run}@x.gr`, firstName: 'Μαρία', lastName: 'Υποδοχή' },
      ])
      .returning({ id: users.id });
    receptionId = u[1]!.id;
    await systemDb.insert(gymRoles).values([
      { gymId, userId: u[0]!.id, role: 'owner' },
      { gymId, userId: receptionId, role: 'reception' },
    ]);
    token.owner = signAccessToken({ sub: u[0]!.id, adm: false });
    token.reception = signAccessToken({ sub: receptionId, adm: false });
  });

  beforeEach(() => resetThrottle(app));

  afterAll(async () => {
    const ids = systemDb
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    if (gymId) {
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, gymId));
      await systemDb.delete(signupCodes).where(eq(signupCodes.gymId, gymId));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
      await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    }
    await systemDb.delete(emailVerifications).where(inArray(emailVerifications.userId, ids));
    await systemDb.delete(refreshTokens).where(inArray(refreshTokens.userId, ids));
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('records the code being issued and the member signing up, with the right actors and no password', async () => {
    const code = await newCode();
    const email = `new-${run}@x.gr`;
    expect((await signup(code, email)).status).toBe(201);
    const [member] = await systemDb.select().from(users).where(eq(users.email, email));

    const res = await history(token.owner);
    expect(res.status).toBe(200);
    const entries = res.body.entries as Entry[];
    // Newest first.
    expect(entries.slice(0, 2).map((e) => e.action)).toEqual([
      'member.signed_up',
      'signup_code.issued',
    ]);
    const [signedUp, issued] = entries as [Entry, Entry];
    expect(issued.actor).toEqual({ id: receptionId, fullName: 'Μαρία Υποδοχή' });
    expect(signedUp.actor).toEqual({ id: member!.id, fullName: 'Νέο Μέλος' });
    expect(signedUp.entityId).toBe(member!.id);

    const raw = JSON.stringify(entries);
    expect(raw).not.toContain('secret password 1');
    expect(raw).not.toContain(member!.passwordHash!);
    // The code itself is a credential while unused; history never shows it.
    expect(raw).not.toContain(code.replace('-', ''));
  });

  it('writes no member.signed_up entry when the sign-up rolls back (already a member)', async () => {
    const email = `twice-${run}@x.gr`;
    expect((await signup(await newCode(), email)).status).toBe(201);
    const before = await systemDb
      .select()
      .from(auditLog)
      .where(sql`${auditLog.gymId} = ${gymId} and ${auditLog.action} = 'member.signed_up'`);

    expect((await signup(await newCode(), email)).status).toBe(409);
    const after = await systemDb
      .select()
      .from(auditLog)
      .where(sql`${auditLog.gymId} = ${gymId} and ${auditLog.action} = 'member.signed_up'`);
    expect(after).toHaveLength(before.length);
  });

  it('leaves no member.signed_up entry when the sign-up fails after the entry was written', async () => {
    // The 409 above throws before the entry is written, so it can't show atomicity. Here the
    // failure comes after audit.record, inside the same transaction.
    const svc = app.get(SignupService, { strict: false });
    const spy = vi
      .spyOn(svc as unknown as { storeVerification: () => Promise<string> }, 'storeVerification')
      .mockRejectedValue(new Error('boom'));
    const email = `boom-${run}@x.gr`;
    try {
      expect((await signup(await newCode(), email)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await systemDb.select().from(users).where(eq(users.email, email))).toEqual([]);
    const entries = (await history(token.owner, '?limit=100')).body.entries as Entry[];
    expect(
      entries.filter((e) => e.action === 'member.signed_up' && e.actor?.fullName === 'Νέο Μέλος'),
    ).toHaveLength(2); // only the two earlier successful sign-ups (new-, twice-)
  });

  it('is for the owner only: reception gets 403', async () => {
    expect((await history(token.reception)).status).toBe(403);
  });

  it('pages with limit and nextBefore, newest first, without repeating entries', async () => {
    const all = (await history(token.owner, '?limit=50')).body.entries as Entry[];
    expect(all.length).toBeGreaterThanOrEqual(3);

    const page1 = await history(token.owner, '?limit=1');
    expect(page1.body.entries).toHaveLength(1);
    expect(page1.body.entries[0].id).toBe(all[0]!.id);
    expect(typeof page1.body.nextBefore).toBe('string');

    const page2 = await history(token.owner, `?limit=1&before=${page1.body.nextBefore}`);
    expect(page2.body.entries).toHaveLength(1);
    expect(page2.body.entries[0].id).toBe(all[1]!.id);
  });

  it('filters by entity and entity id', async () => {
    const all = (await history(token.owner, '?limit=50')).body.entries as Entry[];
    const signedUp = all.find((e) => e.action === 'member.signed_up')!;
    const res = await history(
      token.owner,
      `?entity=${signedUp.entity}&entityId=${signedUp.entityId}`,
    );
    expect(res.status).toBe(200);
    const entries = res.body.entries as Entry[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const e of entries) {
      expect(e.entity).toBe(signedUp.entity);
      expect(e.entityId).toBe(signedUp.entityId);
    }
  });

  it('gives no nextBefore when the last page is exactly full', async () => {
    const all = (await history(token.owner, '?limit=100')).body.entries as Entry[];
    const res = await history(token.owner, `?limit=${all.length}`);
    expect(res.body.entries).toHaveLength(all.length);
    expect(res.body.nextBefore).toBeNull();
  });

  it('rejects a before cursor too large to be an entry id with 400', async () => {
    expect((await history(token.owner, '?before=9999999999999999')).status).toBe(400);
  });

  it('returns nextBefore null on the last page', async () => {
    const res = await history(token.owner, '?limit=50');
    expect(res.body.nextBefore).toBeNull();
  });
});
