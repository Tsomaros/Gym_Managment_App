import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StaffList } from '@gym/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import { auditLog, gymRoles, gyms, invitations, users } from '../src/db/schema';
import { type MailMessage, MailService } from '../src/mail/mail.service';
import { configureApp } from '../src/main';
import { StaffService } from '../src/staff/staff.service';

class FakeMail {
  sent: MailMessage[] = [];
  send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    return Promise.resolve();
  }
}

describe('staff list, role removal, invitation cancel', () => {
  const run = randomUUID().slice(0, 8);
  const mail = new FakeMail();
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const server = () => app.getHttpServer();

  async function person(key: string, roles: string[], gym = gymId): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({
        email: `${key}-${run}@x.gr`,
        firstName: key,
        lastName: 'Staff',
        phone: '6900000000',
      })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb
      .insert(gymRoles)
      .values(roles.map((role) => ({ gymId: gym, userId: u!.id, role }) as never));
  }
  const staff = async (token: string): Promise<StaffList> =>
    (
      await request(server())
        .get(`/gyms/${gymId}/staff`)
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as StaffList;
  const remove = (token: string, userId: string, role: string, gym = gymId) =>
    request(server())
      .delete(`/gyms/${gym}/staff/${userId}/roles/${role}`)
      .auth(token, { type: 'bearer' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    const gs = await systemDb
      .insert(gyms)
      .values([{ name: `Staff ${run}` }, { name: `Staff other ${run}` }])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('trainer', ['trainer', 'member']);
    await person('memberonly', ['member']);
    await person('otherowner', ['owner'], otherGymId);
  });

  afterAll(async () => {
    const ids = [gymId, otherGymId].filter(Boolean);
    for (const g of ids) {
      await systemDb.delete(invitations).where(eq(invitations.gymId, g));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, g));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, g));
      await systemDb.delete(gyms).where(eq(gyms.id, g));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('lists staff with roles (not member-only people) and shows pending invites to the owner only', async () => {
    await request(server())
      .post(`/gyms/${gymId}/invitations`)
      .auth(tok.owner!, { type: 'bearer' })
      .send({
        email: `pending-${run}@x.gr`,
        firstName: 'Pen',
        lastName: 'Ding',
        roles: ['trainer'],
      })
      .expect(201);

    // Not staff invitations, not this gym's: neither may show up under "pending".
    await request(server())
      .post(`/gyms/${gymId}/invitations`)
      .auth(tok.owner!, { type: 'bearer' })
      .send({
        email: `memberinvite-${run}@x.gr`,
        firstName: 'Mem',
        lastName: 'Ber',
        roles: ['member'],
      })
      .expect(201);
    await request(server())
      .post(`/gyms/${otherGymId}/invitations`)
      .auth(tok.otherowner!, { type: 'bearer' })
      .send({
        email: `otherpending-${run}@x.gr`,
        firstName: 'Oth',
        lastName: 'Er',
        roles: ['trainer'],
      })
      .expect(201);

    const asOwner = await staff(tok.owner!);
    const byId = new Map(asOwner.staff.map((s) => [s.userId, s]));
    expect(byId.get(id.owner!)?.roles).toEqual(['owner']);
    expect(byId.get(id.trainer!)?.roles).toEqual(['trainer']);
    expect(byId.get(id.trainer!)).toMatchObject({ firstName: 'trainer', phone: '6900000000' });
    expect(byId.has(id.memberonly!)).toBe(false);
    expect(byId.has(id.otherowner!)).toBe(false); // another gym's owner
    expect(asOwner.pending.map((p) => p.email)).toEqual([`pending-${run}@x.gr`]);
    expect(asOwner.pending[0]!.roles).toEqual(['trainer']);

    const asReception = await staff(tok.rec!);
    expect(asReception.pending).toEqual([]);
    expect(asReception.staff.map((s) => s.userId)).toContain(id.trainer);

    await request(server())
      .get(`/gyms/${gymId}/staff`)
      .auth(tok.trainer!, { type: 'bearer' })
      .expect(403);
  });

  it('cancels a pending invitation: the link then gives 410, and it is recorded', async () => {
    await request(server())
      .post(`/gyms/${gymId}/invitations`)
      .auth(tok.owner!, { type: 'bearer' })
      .send({
        email: `cancelme-${run}@x.gr`,
        firstName: 'Can',
        lastName: 'Cel',
        roles: ['reception'],
      })
      .expect(201);
    const link = mail.sent.at(-1)!.text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1]!;
    const pending = (await staff(tok.owner!)).pending.find(
      (p) => p.email === `cancelme-${run}@x.gr`,
    )!;

    await request(server())
      .post(`/gyms/${gymId}/invitations/${pending.id}/cancel`)
      .auth(tok.rec!, { type: 'bearer' })
      .expect(403);
    await request(server())
      .post(`/gyms/${gymId}/invitations/${pending.id}/cancel`)
      .auth(tok.owner!, { type: 'bearer' })
      .expect(204);
    await request(server())
      .post('/auth/accept-invite')
      .send({ token: link, password: 'a new password' })
      .expect(410);
    expect((await staff(tok.owner!)).pending.map((p) => p.id)).not.toContain(pending.id);
    const rows = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.gymId, gymId), eq(auditLog.action, 'invitation.cancelled')));
    expect(rows).toHaveLength(1);
    // already cancelled: not found
    await request(server())
      .post(`/gyms/${gymId}/invitations/${pending.id}/cancel`)
      .auth(tok.owner!, { type: 'bearer' })
      .expect(404);

    // another gym's pending invitation can't be cancelled through this gym's route (or by its owner)
    const [foreign] = await systemDb
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.email, `otherpending-${run}@x.gr`));
    await request(server())
      .post(`/gyms/${gymId}/invitations/${foreign!.id}/cancel`)
      .auth(tok.owner!, { type: 'bearer' })
      .expect(404);
    await request(server())
      .post(`/gyms/${otherGymId}/invitations/${foreign!.id}/cancel`)
      .auth(tok.owner!, { type: 'bearer' })
      .expect(403);
    const still = await systemDb.select().from(invitations).where(eq(invitations.id, foreign!.id));
    expect(still).toHaveLength(1);
    await request(server())
      .post(`/gyms/${gymId}/invitations/not-a-uuid/cancel`)
      .auth(tok.owner!, { type: 'bearer' })
      .expect(400);
  });

  it("removes a trainer's trainer role: 204, no more trainer access, member access intact, one history row", async () => {
    await request(server())
      .get(`/gyms/${gymId}/check-ins/present`)
      .auth(tok.trainer!, { type: 'bearer' })
      .expect(200);

    await request(server())
      .get(`/gyms/${gymId}/me/memberships`)
      .auth(tok.trainer!, { type: 'bearer' })
      .expect(200);

    await remove(tok.owner!, id.trainer!, 'trainer').expect(204);

    await request(server())
      .get(`/gyms/${gymId}/check-ins/present`)
      .auth(tok.trainer!, { type: 'bearer' })
      .expect(403);
    // their member access is untouched
    await request(server())
      .get(`/gyms/${gymId}/me/memberships`)
      .auth(tok.trainer!, { type: 'bearer' })
      .expect(200);
    const roles = await systemDb
      .select({ role: gymRoles.role })
      .from(gymRoles)
      .where(and(eq(gymRoles.gymId, gymId), eq(gymRoles.userId, id.trainer!)));
    expect(roles.map((r) => r.role)).toEqual(['member']);
    const rows = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.gymId, gymId), eq(auditLog.action, 'staff.role_removed')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: id.trainer });
    expect(rows[0]!.data).toMatchObject({ role: 'trainer' });
    // the role is gone now
    await remove(tok.owner!, id.trainer!, 'trainer').expect(404);
    // the person is a member only: no longer listed as staff
    expect((await staff(tok.owner!)).staff.map((s) => s.userId)).not.toContain(id.trainer);
  });

  it('refuses reception, members as a role, and another gym', async () => {
    await remove(tok.rec!, id.rec!, 'reception').expect(403);
    await remove(tok.owner!, id.memberonly!, 'member').expect(400);
    await remove(tok.owner!, id.otherowner!, 'owner').expect(404);
    await remove(tok.otherowner!, id.rec!, 'reception', gymId).expect(403);
    await remove(tok.owner!, id.rec!, 'banana').expect(400);
    await remove(tok.owner!, 'not-a-uuid', 'reception').expect(400);
    // none of the refused calls changed anything
    const left = await systemDb
      .select({ userId: gymRoles.userId, role: gymRoles.role })
      .from(gymRoles)
      .where(inArray(gymRoles.userId, [id.rec!, id.memberonly!, id.otherowner!]));
    expect(left.map((r) => `${r.userId}:${r.role}`).sort()).toEqual(
      [`${id.rec}:reception`, `${id.memberonly}:member`, `${id.otherowner}:owner`].sort(),
    );
  });

  it('refuses to remove the last owner, and exactly one of two owners removing each other wins', async () => {
    await remove(tok.owner!, id.owner!, 'owner').expect(409);

    // Past the HTTP guards (the loser's role check may already see the winner's commit and give
    // 403), call the service itself so both calls reach the lock.
    await person('owner2', ['owner']);
    const staffService = app.get(StaffService);
    const results = await Promise.allSettled([
      staffService.removeRole(gymId, id.owner!, id.owner2!, 'owner'),
      staffService.removeRole(gymId, id.owner2!, id.owner!, 'owner'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as { status?: number }).status).toBe(409);
    const owners = await systemDb
      .select()
      .from(gymRoles)
      .where(and(eq(gymRoles.gymId, gymId), eq(gymRoles.role, 'owner')));
    expect(owners).toHaveLength(1);
  });

  it('removing an owner role waits for the lock on the gym owner rows', async () => {
    // Deterministic check of the FOR UPDATE: hold a lock on one owner's row from outside. Removing
    // the other owner must not get past its owner count until the lock is released.
    await person('ownerc', ['owner']); // keys become emails, which must be lower case
    await person('ownerd', ['owner']);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const hasLock = new Promise<void>((r) => (locked = r));
    const holder = systemDb.transaction(async (tx) => {
      await tx
        .select()
        .from(gymRoles)
        .where(and(eq(gymRoles.gymId, gymId), eq(gymRoles.userId, id.ownerd!)))
        .for('update');
      locked();
      await gate;
    });
    await hasLock;
    let done = false;
    const removal = app
      .get(StaffService)
      .removeRole(gymId, id.owner!, id.ownerc!, 'owner')
      .then(() => (done = true));
    await new Promise((r) => setTimeout(r, 500));
    expect(done).toBe(false);
    release();
    await holder;
    await removal;
    expect(done).toBe(true);
  });
});
