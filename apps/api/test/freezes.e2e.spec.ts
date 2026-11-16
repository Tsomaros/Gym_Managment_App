import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Freeze, Membership, MembershipType } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  gymRoles,
  gyms,
  membershipFreezes,
  memberships,
  membershipTypes,
  payments,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';
import { toMembership } from '../src/memberships/memberships.service';

class TestClock {
  current = new Date('2027-05-01T09:00:00Z');
  now(): Date {
    return this.current;
  }
  /** 09:00 UTC (12:00 in Athens) on the given day. */
  setDay(iso: string): void {
    this.current = new Date(`${iso}T09:00:00Z`);
  }
}

/**
 * One story, run in order: a 1-month membership with up to 14 freeze days, sold on 1 May 2027,
 * so its paid period ends on 31 May.
 */
describe('freezes (gym in Europe/Athens)', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let memberId: string;
  let token: string;
  let ownerToken: string;
  let monthly: MembershipType;
  let membership: Membership;
  let freeze: Freeze;

  const server = () => app.getHttpServer();
  const createFreeze = (membershipId: string, startsOn: string, endsOn: string) =>
    request(server())
      .post(`/gyms/${gymId}/memberships/${membershipId}/freezes`)
      .auth(token, { type: 'bearer' })
      .send({ startsOn, endsOn });
  const endFreeze = (freezeId: string) =>
    request(server())
      .post(`/gyms/${gymId}/freezes/${freezeId}/end`)
      .auth(token, { type: 'bearer' });
  const sell = (typeId: string, amountCents: number) =>
    request(server())
      .post(`/gyms/${gymId}/members/${memberId}/memberships`)
      .auth(token, { type: 'bearer' })
      .send({ typeId, amountCents, method: 'cash' });

  /** The membership as the API computes it on `today`, from the stored rows. */
  async function stateOn(membershipId: string, today: string): Promise<Membership> {
    const [row] = await systemDb.select().from(memberships).where(eq(memberships.id, membershipId));
    const freezes = await systemDb
      .select()
      .from(membershipFreezes)
      .where(eq(membershipFreezes.membershipId, membershipId));
    return toMembership(row!, freezes, today);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Freeze ${run}`, timezone: 'Europe/Athens' })
      .returning({ id: gyms.id });
    gymId = g!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `owner-${run}@x.gr`, firstName: 'Νίκος', lastName: 'Ιδιοκτήτης' },
        { email: `rec-${run}@x.gr`, firstName: 'Μαρία', lastName: 'Υποδοχή' },
        { email: `mem-${run}@x.gr`, firstName: 'Γιώργος', lastName: 'Μέλος' },
      ])
      .returning({ id: users.id });
    memberId = u[2]!.id;
    await systemDb.insert(gymRoles).values([
      { gymId, userId: u[0]!.id, role: 'owner' },
      { gymId, userId: u[1]!.id, role: 'reception' },
      { gymId, userId: memberId, role: 'member' },
    ]);
    ownerToken = signAccessToken({ sub: u[0]!.id, adm: false });
    token = signAccessToken({ sub: u[1]!.id, adm: false });

    const res = await request(server())
      .post(`/gyms/${gymId}/membership-types`)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        name: 'Μηνιαία',
        kind: 'time',
        durationMonths: 1,
        priceCents: 4000,
        maxFreezeDays: 14,
      });
    monthly = res.body as MembershipType;

    clock.setDay('2027-05-01');
    membership = (await sell(monthly.id, 4000)).body as Membership;
    expect(membership).toMatchObject({ startsOn: '2027-05-01', endsOn: '2027-05-31' });
  });

  afterAll(async () => {
    if (gymId) {
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, gymId));
      await systemDb.delete(membershipFreezes).where(eq(membershipFreezes.gymId, gymId));
      await systemDb.delete(payments).where(eq(payments.gymId, gymId));
      await systemDb.delete(memberships).where(eq(memberships.gymId, gymId));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, gymId));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
      await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('freezes 10–16 May (7 days): the end moves to 7 June, and on 12 May the status is frozen', async () => {
    const res = await createFreeze(membership.id, '2027-05-10', '2027-05-16');
    expect(res.status).toBe(201);
    freeze = res.body as Freeze;
    expect(freeze).toMatchObject({
      membershipId: membership.id,
      startsOn: '2027-05-10',
      endsOn: '2027-05-16',
    });

    const [row] = await systemDb
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(row).toMatchObject({ baseEndsOn: '2027-05-31', endsOn: '2027-06-07' });
    expect(await stateOn(membership.id, '2027-05-12')).toMatchObject({
      status: 'frozen',
      effectiveEndsOn: '2027-06-07',
    });
    expect((await stateOn(membership.id, '2027-05-09')).status).toBe('active');
  });

  it('refuses a second freeze that would pass 14 days in total, saying how many are left', async () => {
    const res = await createFreeze(membership.id, '2027-05-20', '2027-05-27');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ remainingFreezeDays: 7 });
  });

  it('refuses an overlapping freeze (409) and one starting in the past (400)', async () => {
    expect((await createFreeze(membership.id, '2027-05-14', '2027-05-18')).status).toBe(409);
    expect((await createFreeze(membership.id, '2027-04-30', '2027-05-02')).status).toBe(400);
    expect((await createFreeze(membership.id, '2027-05-20', '2027-05-19')).status).toBe(400);
    // Sharing only the last frozen day (16 May) is still an overlap; 7 + 2 days is within the 14.
    expect((await createFreeze(membership.id, '2027-05-16', '2027-05-17')).status).toBe(409);
    // Starting after the extended end (7 June) is outside the membership.
    expect((await createFreeze(membership.id, '2027-06-08', '2027-06-09')).status).toBe(400);
  });

  it('starts a renewal sold while frozen on the day after the extended end (8 June)', async () => {
    clock.setDay('2027-05-12');
    const res = await sell(monthly.id, 4000);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startsOn: '2027-06-08', endsOn: '2027-07-07' });
  });

  it('ending the running freeze on 12 May keeps 10–11 May frozen and moves the end to 2 June', async () => {
    clock.setDay('2027-05-12');
    expect((await endFreeze(freeze.id)).status).toBe(204);

    const [f] = await systemDb
      .select()
      .from(membershipFreezes)
      .where(eq(membershipFreezes.id, freeze.id));
    expect(f).toMatchObject({ startsOn: '2027-05-10', endsOn: '2027-05-11' });
    expect(f!.endedEarlyAt).not.toBeNull();
    expect(await stateOn(membership.id, '2027-05-12')).toMatchObject({
      status: 'active',
      effectiveEndsOn: '2027-06-02',
    });
    // 10–11 May is now over, so it can't be ended again.
    expect((await endFreeze(freeze.id)).status).toBe(409);
  });

  it('deletes a freeze that has not started when it is ended, and gives the days back', async () => {
    clock.setDay('2027-05-12');
    const later = (await createFreeze(membership.id, '2027-05-20', '2027-05-21')).body as Freeze;
    expect((await stateOn(membership.id, '2027-05-12')).effectiveEndsOn).toBe('2027-06-04');

    expect((await endFreeze(later.id)).status).toBe(204);
    const rows = await systemDb
      .select()
      .from(membershipFreezes)
      .where(eq(membershipFreezes.id, later.id));
    expect(rows).toHaveLength(0);
    expect((await stateOn(membership.id, '2027-05-12')).effectiveEndsOn).toBe('2027-06-02');
  });

  it('deletes a freeze that started today when it is ended', async () => {
    clock.setDay('2027-05-13');
    const today = (await createFreeze(membership.id, '2027-05-13', '2027-05-14')).body as Freeze;
    expect((await endFreeze(today.id)).status).toBe(204);
    const rows = await systemDb
      .select()
      .from(membershipFreezes)
      .where(eq(membershipFreezes.id, today.id));
    expect(rows).toHaveLength(0);
    expect((await stateOn(membership.id, '2027-05-13')).effectiveEndsOn).toBe('2027-06-02');
  });

  it('refuses to freeze a visit pack (409)', async () => {
    const pack = await request(server())
      .post(`/gyms/${gymId}/membership-types`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ name: 'Δεκάρα', kind: 'visits', visitCount: 10, priceCents: 5000 });
    const sold = (await sell((pack.body as MembershipType).id, 5000)).body as Membership;
    expect((await createFreeze(sold.id, '2027-05-20', '2027-05-21')).status).toBe(409);
  });

  it('refuses to freeze an expired membership (409)', async () => {
    clock.setDay('2027-06-03'); // the first membership ended on 2 June
    expect((await createFreeze(membership.id, '2027-06-04', '2027-06-05')).status).toBe(409);
  });

  it('lets reception and the owner in, keeps members out, and rejects malformed ids (400)', async () => {
    const asMember = signAccessToken({ sub: memberId, adm: false });
    const url = `/gyms/${gymId}/memberships/${membership.id}/freezes`;
    const body = { startsOn: '2027-06-04', endsOn: '2027-06-05' };
    expect((await request(server()).post(url).auth(asMember, { type: 'bearer' }).send(body)).status).toBe(403);
    expect((await request(server()).post(url).send(body)).status).toBe(401);
    // The membership has expired (409), not refused by the guard: the owner satisfies reception.
    expect((await request(server()).post(url).auth(ownerToken, { type: 'bearer' }).send(body)).status).toBe(409);
    expect(
      (await request(server()).post(`/gyms/${gymId}/freezes/${freeze.id}/end`).auth(asMember, { type: 'bearer' })).status,
    ).toBe(403);
    expect((await createFreeze('not-a-uuid', '2027-07-01', '2027-07-02')).status).toBe(400);
    expect((await endFreeze('not-a-uuid')).status).toBe(400);
  });

  it('answers an unknown membership or freeze with 404', async () => {
    expect((await createFreeze(randomUUID(), '2027-07-01', '2027-07-02')).status).toBe(404);
    expect((await endFreeze(randomUUID())).status).toBe(404);
  });

  it('records freeze.created and freeze.ended in the history', async () => {
    const rows = await systemDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(sql`${auditLog.gymId} = ${gymId} and ${auditLog.entity} = 'freeze'`);
    const actions = rows.map((r) => r.action);
    expect(actions.filter((a) => a === 'freeze.created')).toHaveLength(3);
    expect(actions.filter((a) => a === 'freeze.ended')).toHaveLength(3);
  });
});
