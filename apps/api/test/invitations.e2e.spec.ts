import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MeResponseSchema } from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import { auditLog, gymRoles, gyms, invitations, refreshTokens, users } from '../src/db/schema';
import { type MailMessage, MailService } from '../src/mail/mail.service';
import { configureApp } from '../src/main';

class FakeMail {
  sent: MailMessage[] = [];
  failNext = false;
  send(msg: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('SMTP down'));
    }
    this.sent.push(msg);
    return Promise.resolve();
  }
}

const tokenFrom = (msg: MailMessage | undefined): string => {
  const match = msg?.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no invite link in: ${msg?.text}`);
  return match[1]!;
};

describe('gyms and invitations', () => {
  const run = randomUUID().slice(0, 8);
  const mail = new FakeMail();
  const createdGyms: string[] = [];
  let app: INestApplication;
  let adminToken: string;

  const server = () => app.getHttpServer();
  const createGym = (
    name: string,
    ownerEmail: string,
    ownerFirstName = 'Owner',
    ownerLastName = 'Test',
  ) =>
    request(server())
      .post('/platform/gyms')
      .auth(adminToken, { type: 'bearer' })
      .send({ name, ownerEmail, ownerFirstName, ownerLastName });
  const accept = (token: string, password = 'a new password') =>
    request(server()).post('/auth/accept-invite').send({ token, password });
  const me = (accessToken: string) =>
    request(server()).get('/auth/me').auth(accessToken, { type: 'bearer' });

  /** Creates a gym with a fresh owner and returns the gym id and the owner's access token. */
  async function gymWithOwner(name: string): Promise<{ gymId: string; ownerToken: string }> {
    const res = await createGym(name, `owner-${randomUUID().slice(0, 6)}-${run}@x.gr`);
    expect(res.status).toBe(201);
    const gymId = (res.body as { gymId: string }).gymId;
    createdGyms.push(gymId);
    const accepted = await accept(tokenFrom(mail.sent.at(-1)));
    expect(accepted.status).toBe(200);
    return { gymId, ownerToken: (accepted.body as { accessToken: string }).accessToken };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const [admin] = await systemDb
      .insert(users)
      .values({
        email: `admin-${run}@x.gr`,
        firstName: 'Admin',
        lastName: 'Test',
        isPlatformAdmin: true,
      })
      .returning({ id: users.id });
    adminToken = signAccessToken({ sub: admin!.id, adm: true });
  });

  beforeEach(() => {
    mail.sent = [];
  });

  afterAll(async () => {
    const emails = sql`${users.email} like ${`%-${run}@x.gr`}`;
    const ids = systemDb.select({ id: users.id }).from(users).where(emails);
    if (createdGyms.length) {
      await systemDb.delete(invitations).where(inArray(invitations.gymId, createdGyms));
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, createdGyms));
    }
    await systemDb.delete(gymRoles).where(sql`${gymRoles.userId} in ${ids}`);
    await systemDb.delete(refreshTokens).where(sql`${refreshTokens.userId} in ${ids}`);
    await systemDb.delete(users).where(emails);
    if (createdGyms.length) {
      await systemDb.delete(auditLog).where(inArray(auditLog.gymId, createdGyms));
      await systemDb.delete(gyms).where(inArray(gyms.id, createdGyms));
    }
    await app?.close();
  });

  it('platform admin creates a gym and the owner gets a Greek invite email with a link', async () => {
    const res = await createGym('Γυμναστήριο Ναυπάκτου', ` Owner-Nafpaktos-${run}@X.gr`);
    expect(res.status).toBe(201);
    expect(res.body.mailSent).toBe(true);
    createdGyms.push((res.body as { gymId: string }).gymId);

    expect(mail.sent).toHaveLength(1);
    const [msg] = mail.sent;
    expect(msg!.to).toBe(`owner-nafpaktos-${run}@x.gr`);
    expect(msg!.text).toContain('/invite/');
    expect(msg!.text).toContain('Γυμναστήριο Ναυπάκτου');
    expect(msg!.subject).toMatch(/[α-ωΑ-Ω]/); // Greek by default
  });

  it('still returns the new gym id when the invite email fails, flagged mailSent: false', async () => {
    mail.failNext = true;
    const res = await createGym(`Mailless ${run}`, `owner-mailless-${run}@x.gr`);
    expect(res.status).toBe(201);
    const { gymId, mailSent } = res.body as { gymId: string; mailSent: boolean };
    createdGyms.push(gymId);
    expect(mailSent).toBe(false);
    const stored = await systemDb.select({ id: gyms.id }).from(gyms).where(eq(gyms.id, gymId));
    expect(stored).toHaveLength(1);
    // The owner invitation must be stored too, otherwise "send it again" has nothing to resend.
    const pending = await systemDb
      .select({ roles: invitations.roles, acceptedAt: invitations.acceptedAt })
      .from(invitations)
      .where(eq(invitations.gymId, gymId));
    expect(pending).toEqual([{ roles: ['owner'], acceptedAt: null }]);
    expect(mail.sent).toHaveLength(0);
  });

  it('only the platform admin may create gyms', async () => {
    const { ownerToken } = await gymWithOwner(`Owned ${run}`);
    const res = await request(server())
      .post('/platform/gyms')
      .auth(ownerToken, { type: 'bearer' })
      .send({
        name: 'Mine',
        ownerEmail: `x-${run}@x.gr`,
        ownerFirstName: 'X',
        ownerLastName: 'Test',
      });
    expect(res.status).toBe(403);
  });

  it('accepting the owner invite signs in and /auth/me lists the gym with roles [owner]', async () => {
    const res = await createGym(`Accept ${run}`, `owner-accept-${run}@x.gr`);
    const gymId = (res.body as { gymId: string }).gymId;
    createdGyms.push(gymId);

    const accepted = await accept(tokenFrom(mail.sent[0]));
    expect(accepted.status).toBe(200);
    expect(accepted.headers['set-cookie']?.[0]).toMatch(/^gym_rt=/);

    const body = MeResponseSchema.parse((await me(accepted.body.accessToken as string)).body);
    expect(body.gyms).toEqual([{ gymId, gymName: `Accept ${run}`, roles: ['owner'] }]);
  });

  it('answers a second accept of the same token with 410', async () => {
    const res = await createGym(`Twice ${run}`, `owner-twice-${run}@x.gr`);
    createdGyms.push((res.body as { gymId: string }).gymId);
    const token = tokenFrom(mail.sent[0]);

    expect((await accept(token)).status).toBe(200);
    expect((await accept(token)).status).toBe(410);
  });

  it('answers an invite older than 72 hours with 410', async () => {
    const res = await createGym(`Expired ${run}`, `owner-expired-${run}@x.gr`);
    const gymId = (res.body as { gymId: string }).gymId;
    createdGyms.push(gymId);
    const updated = await systemDb
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.gymId, gymId))
      .returning({ id: invitations.id });
    expect(updated).toHaveLength(1);

    expect((await accept(tokenFrom(mail.sent[0]))).status).toBe(410);
  });

  it('previews an invitation by token, so the invite page knows whether to ask for a password', async () => {
    const res = await createGym(`Preview ${run}`, `owner-preview-${run}@x.gr`, 'Νίκος', 'Αλεξίου');
    createdGyms.push((res.body as { gymId: string }).gymId);
    const token = tokenFrom(mail.sent[0]);

    const preview = await request(server()).get(`/auth/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      gymName: `Preview ${run}`,
      fullName: 'Νίκος Αλεξίου',
      email: `owner-preview-${run}@x.gr`,
      accountExists: false,
    });

    await accept(token);
    expect((await request(server()).get(`/auth/invitations/${token}`)).status).toBe(410);
    expect((await request(server()).get('/auth/invitations/no-such-token')).status).toBe(410);
  });

  it('answers an unknown token with 410', async () => {
    expect((await accept('no-such-token')).status).toBe(410);
  });

  describe('POST /gyms/:gymId/invitations', () => {
    let gymId: string;
    let ownerToken: string;
    let receptionToken: string;

    const invite = (bearer: string, body: object) =>
      request(server())
        .post(`/gyms/${gymId}/invitations`)
        .auth(bearer, { type: 'bearer' })
        .send(body);

    beforeAll(async () => {
      ({ gymId, ownerToken } = await gymWithOwner(`Desk ${run}`));
      mail.sent = [];
      const res = await invite(ownerToken, {
        email: `reception-${run}@x.gr`,
        firstName: 'Reception',
        lastName: 'Test',
        roles: ['reception'],
      });
      expect(res.status).toBe(201);
      const accepted = await accept(tokenFrom(mail.sent[0]));
      receptionToken = (accepted.body as { accessToken: string }).accessToken;
    });

    it('lets reception invite a member (201) but not a trainer (403)', async () => {
      const trainer = await invite(receptionToken, {
        email: `trainer-${run}@x.gr`,
        firstName: 'Trainer',
        lastName: 'Test',
        roles: ['trainer'],
      });
      expect(trainer.status).toBe(403);

      const member = await invite(receptionToken, {
        email: `walkin-${run}@x.gr`,
        firstName: 'Walk',
        lastName: 'In',
        roles: ['member'],
      });
      expect(member.status).toBe(201);
      expect(typeof member.body.invitationId).toBe('string');
    });

    it('does not let reception overwrite a pending trainer invitation (409), the trainer link stays valid', async () => {
      const email = `pending-coach-${run}@x.gr`;
      mail.sent = [];
      const first = await invite(ownerToken, {
        email,
        firstName: 'Coach',
        lastName: 'Test',
        roles: ['trainer'],
      });
      expect(first.status).toBe(201);
      const trainerToken = tokenFrom(mail.sent[0]);
      const overwrite = await invite(receptionToken, {
        email,
        firstName: 'Coach',
        lastName: 'Test',
        roles: ['member'],
      });
      expect(overwrite.status).toBe(409);
      expect(mail.sent).toHaveLength(1); // the refused attempt sent no second link
      expect((await accept(trainerToken)).status).toBe(200);
      // The stored roles were not downgraded: the account got trainer, not member.
      const granted = await systemDb
        .select({ role: gymRoles.role })
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(eq(users.email, email));
      expect(granted).toEqual([{ role: 'trainer' }]);
    });

    it('lets reception re-send a pending member invitation, replacing the old link', async () => {
      const email = `resend-${run}@x.gr`;
      const first = await invite(receptionToken, {
        email,
        firstName: 'Resend',
        lastName: 'Test',
        roles: ['member'],
      });
      expect(first.status).toBe(201);
      const oldToken = tokenFrom(mail.sent.at(-1));
      const again = await invite(receptionToken, {
        email,
        firstName: 'Resend',
        lastName: 'Test',
        roles: ['member'],
      });
      expect(again.status).toBe(201);
      expect(again.body).toEqual({ invitationId: first.body.invitationId, mailSent: true });
      expect((await accept(oldToken)).status).toBe(410);
      expect((await accept(tokenFrom(mail.sent.at(-1)))).status).toBe(200);
    });

    it('lets the owner invite a trainer', async () => {
      const res = await invite(ownerToken, {
        email: `coach-${run}@x.gr`,
        firstName: 'Coach',
        lastName: 'Test',
        roles: ['trainer'],
      });
      expect(res.status).toBe(201);
    });

    it('refuses reception inviting a mixed [member, owner] list and sends no mail', async () => {
      mail.sent = [];
      const res = await invite(receptionToken, {
        email: `mixed-${run}@x.gr`,
        firstName: 'Mixed',
        lastName: 'Test',
        roles: ['member', 'owner'],
      });
      expect(res.status).toBe(403);
      expect(mail.sent).toHaveLength(0);
    });

    it('re-inviting a pending email replaces the old link (old 410, new 200)', async () => {
      mail.sent = [];
      const body = {
        email: `again-${run}@x.gr`,
        firstName: 'Again',
        lastName: 'Test',
        roles: ['member'],
      };
      expect((await invite(ownerToken, body)).status).toBe(201);
      expect((await invite(ownerToken, body)).status).toBe(201);
      const [first, second] = mail.sent.map(tokenFrom);
      expect(first).not.toBe(second);

      expect((await accept(first!)).status).toBe(410);
      expect((await accept(second!)).status).toBe(200);
    });

    it('rejects accepting with a too-short password (400) and keeps the invite usable', async () => {
      mail.sent = [];
      await invite(ownerToken, {
        email: `shortpw-${run}@x.gr`,
        firstName: 'Short',
        lastName: 'Test',
        roles: ['member'],
      });
      const token = tokenFrom(mail.sent[0]);
      expect((await accept(token, 'abc')).status).toBe(400);
      expect((await accept(token)).status).toBe(200);
    });

    it('writes the invite in English when the existing account prefers en', async () => {
      const email = `english-${run}@x.gr`;
      await systemDb
        .insert(users)
        .values({ email, firstName: 'Eng', lastName: 'Test', locale: 'en' });
      mail.sent = [];
      const res = await invite(ownerToken, {
        email,
        firstName: 'Eng',
        lastName: 'Test',
        roles: ['member'],
      });
      expect(res.status).toBe(201);
      expect(mail.sent[0]!.subject).toMatch(/^Invitation to /);
      expect(mail.sent[0]!.text).toContain('You have been invited');
    });

    it('keeps a Greek member name byte-identical through invite, accept and /auth/me', async () => {
      const name = 'Γιώργος Παπαδόπουλος';
      await invite(receptionToken, {
        email: `giorgos-${run}@x.gr`,
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
        roles: ['member'],
      });
      const accepted = await accept(tokenFrom(mail.sent.at(-1)));
      const body = MeResponseSchema.parse((await me(accepted.body.accessToken as string)).body);
      expect(body.fullName).toBe(name);
      expect(Buffer.from(body.fullName).equals(Buffer.from(name))).toBe(true);
      // An account created from an emailed invite link has a confirmed email.
      expect(body).toMatchObject({
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
        emailVerified: true,
      });
    });
  });

  it('adds a gym to an existing account instead of creating a second one', async () => {
    const email = `maria-${run}@x.gr`;
    const originalHash = await hashPassword('maria original password');
    const [maria] = await systemDb
      .insert(users)
      .values({ email, firstName: 'Μαρία', lastName: 'Test', passwordHash: originalHash })
      .returning({ id: users.id });
    const gymA = await gymWithOwner(`Maria A ${run}`);
    await systemDb
      .insert(gymRoles)
      .values({ gymId: gymA.gymId, userId: maria!.id, role: 'member' });
    const gymB = await gymWithOwner(`Maria B ${run}`);

    mail.sent = [];
    const invited = await request(server())
      .post(`/gyms/${gymB.gymId}/invitations`)
      .auth(gymB.ownerToken, { type: 'bearer' })
      .send({
        email: ` Maria-${run}@X.gr`,
        firstName: 'Μαρία',
        lastName: 'Test',
        roles: ['member'],
      });
    expect(invited.status).toBe(201);
    expect(mail.sent[0]!.to).toBe(email);

    // The link alone must not sign anyone in to an existing account: roles are added, no session.
    const accepted = await accept(tokenFrom(mail.sent[0]), 'an attempted new password');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ signInRequired: true });
    expect(accepted.headers['set-cookie']).toBeUndefined();

    const rows = await systemDb.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.passwordHash).toBe(originalHash);

    expect(
      (
        await request(server())
          .post('/auth/login')
          .send({ email, password: 'an attempted new password' })
      ).status,
    ).toBe(401);
    const login = await request(server())
      .post('/auth/login')
      .send({ email, password: 'maria original password' });
    expect(login.status).toBe(200);
    const body = MeResponseSchema.parse((await me(login.body.accessToken as string)).body);
    expect(body.id).toBe(maria!.id);
    expect(body.gyms.map((g) => g.gymId).sort()).toEqual([gymA.gymId, gymB.gymId].sort());
    expect(body.gyms.find((g) => g.gymId === gymB.gymId)?.roles).toEqual(['member']);
  });
});
