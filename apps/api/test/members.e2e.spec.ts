import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  Membership,
  MemberDetail,
  MemberSummary,
  MembershipType,
  MyMemberships,
} from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
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

class TestClock {
  current = new Date('2027-05-01T09:00:00Z');
  now(): Date {
    return this.current;
  }
  setDay(iso: string): void {
    this.current = new Date(`${iso}T09:00:00Z`);
  }
}

describe('members list, member detail and my memberships', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  const id = { owner: '', reception: '', giorgos: '', eleni: '', nikos: '', other: '' };
  const token = { owner: '', reception: '', giorgos: '', eleni: '' };
  let monthly: MembershipType;
  let pack: MembershipType;

  const server = () => app.getHttpServer();
  const get = (path: string, bearer: string) =>
    request(server()).get(`/gyms/${gymId}${path}`).auth(bearer, { type: 'bearer' });
  const list = async (query = '', bearer = token.reception) => {
    const res = await get(`/members${query}`, bearer);
    expect(res.status).toBe(200);
    return res.body as MemberSummary[];
  };
  const summaryOf = async (userId: string) => (await list()).find((m) => m.userId === userId)!;
  const sell = (memberId: string, typeId: string, amountCents: number) =>
    request(server())
      .post(`/gyms/${gymId}/members/${memberId}/memberships`)
      .auth(token.reception, { type: 'bearer' })
      .send({ typeId, amountCents, method: 'cash' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const g = await systemDb
      .insert(gyms)
      .values([
        { name: `Members ${run}`, timezone: 'Europe/Athens' },
        { name: `Elsewhere ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = g[0]!.id;
    otherGymId = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `owner-${run}@x.gr`, firstName: 'Άννα', lastName: 'Ιδιοκτήτρια' },
        { email: `rec-${run}@x.gr`, firstName: 'Μαρία', lastName: 'Υποδοχή' },
        {
          email: `giorgos-${run}@x.gr`,
          firstName: 'Γιώργος',
          lastName: 'Παπαδόπουλος',
          phone: '+306912345678',
          dateOfBirth: '1990-05-17',
          emergencyContactName: 'Ελένη Παπαδοπούλου',
          emergencyContactPhone: '+306987654321',
        },
        {
          email: `eleni-${run}@x.gr`,
          firstName: 'Ελένη',
          lastName: 'Νικολάου',
          phone: '+302101234567',
        },
        { email: `nikos-${run}@x.gr`, firstName: 'Νίκος', lastName: 'Αλεξίου' },
        { email: `other-${run}@x.gr`, firstName: 'Γιώργος', lastName: 'Άλλος' },
      ])
      .returning({ id: users.id });
    [id.owner, id.reception, id.giorgos, id.eleni, id.nikos, id.other] = u.map((r) => r.id) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await systemDb.insert(gymRoles).values([
      { gymId, userId: id.owner, role: 'owner' },
      { gymId, userId: id.reception, role: 'reception' },
      { gymId, userId: id.giorgos, role: 'member' },
      { gymId, userId: id.eleni, role: 'member' },
      { gymId, userId: id.nikos, role: 'member' },
      // Same first name, but a member of another gym only.
      { gymId: otherGymId, userId: id.other, role: 'member' },
    ]);
    // One insert gives every row the same created_at, so set distinct sign-up times
    // (giorgos oldest, nikos newest) for the ordering check.
    const joinedAt = { giorgos: '2027-01-01', eleni: '2027-02-01', nikos: '2027-03-01' };
    for (const [who, day] of Object.entries(joinedAt)) {
      await systemDb
        .update(gymRoles)
        .set({ createdAt: new Date(`${day}T10:00:00Z`) })
        .where(
          sql`${gymRoles.gymId} = ${gymId} and ${gymRoles.userId} = ${id[who as keyof typeof joinedAt]}`,
        );
    }
    token.owner = signAccessToken({ sub: id.owner, adm: false });
    token.reception = signAccessToken({ sub: id.reception, adm: false });
    token.giorgos = signAccessToken({ sub: id.giorgos, adm: false });
    token.eleni = signAccessToken({ sub: id.eleni, adm: false });

    const create = (body: Record<string, unknown>) =>
      request(server())
        .post(`/gyms/${gymId}/membership-types`)
        .auth(token.owner, { type: 'bearer' })
        .send(body);
    monthly = (
      await create({
        name: 'Μηνιαία',
        kind: 'time',
        durationMonths: 1,
        priceCents: 4000,
        maxFreezeDays: 14,
      })
    ).body as MembershipType;
    pack = (await create({ name: 'Δεκάρα', kind: 'visits', visitCount: 10, priceCents: 5000 }))
      .body as MembershipType;
  });

  afterAll(async () => {
    const gymIds = [gymId, otherGymId].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(auditLog).where(inArray(auditLog.gymId, gymIds));
      await systemDb.delete(membershipFreezes).where(inArray(membershipFreezes.gymId, gymIds));
      await systemDb.delete(payments).where(inArray(payments.gymId, gymIds));
      await systemDb.delete(memberships).where(inArray(memberships.gymId, gymIds));
      await systemDb.delete(membershipTypes).where(inArray(membershipTypes.gymId, gymIds));
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('lists only members (not staff) of this gym, newest sign-up first, new ones as "new"', async () => {
    const all = await list();
    expect(all.map((m) => m.userId).sort()).toEqual([id.giorgos, id.eleni, id.nikos].sort());
    const giorgos = all.find((m) => m.userId === id.giorgos)!;
    expect(giorgos).toMatchObject({
      firstName: 'Γιώργος',
      lastName: 'Παπαδόπουλος',
      email: `giorgos-${run}@x.gr`,
      phone: '+306912345678',
      emailVerified: false,
      status: 'new',
      currentEndsOn: null,
      visitsLeft: null,
    });
    expect(all.map((m) => m.userId)).toEqual([id.nikos, id.eleni, id.giorgos]);
  });

  it('follows a membership through active, expiring and expired', async () => {
    clock.setDay('2027-05-01');
    expect((await sell(id.giorgos, monthly.id, 4000)).status).toBe(201);
    expect(await summaryOf(id.giorgos)).toMatchObject({
      status: 'active',
      currentEndsOn: '2027-05-31',
    });

    clock.setDay('2027-05-24'); // 8 days left (24–31 May): not yet expiring
    expect((await summaryOf(id.giorgos)).status).toBe('active');
    clock.setDay('2027-05-25'); // 7 days left: expiring starts here
    expect((await summaryOf(id.giorgos)).status).toBe('expiring');
    clock.setDay('2027-05-31'); // last day still counts
    expect(await summaryOf(id.giorgos)).toMatchObject({ status: 'expiring' });

    clock.setDay('2027-06-01');
    expect((await summaryOf(id.giorgos)).status).toBe('expired');
    clock.setDay('2027-05-01');
  });

  it('shows a member as frozen while a freeze runs', async () => {
    clock.setDay('2027-05-01');
    const sold = (await sell(id.eleni, monthly.id, 4000)).body as Membership;
    const freeze = await request(server())
      .post(`/gyms/${gymId}/memberships/${sold.id}/freezes`)
      .auth(token.reception, { type: 'bearer' })
      .send({ startsOn: '2027-05-10', endsOn: '2027-05-16' });
    expect(freeze.status).toBe(201);

    clock.setDay('2027-05-12');
    expect(await summaryOf(id.eleni)).toMatchObject({
      status: 'frozen',
      currentEndsOn: '2027-06-07',
    });
    clock.setDay('2027-05-01');
  });

  it('shows a visit pack with 2 or fewer visits left as expiring, with the visits left', async () => {
    clock.setDay('2027-05-01');
    const sold = (await sell(id.nikos, pack.id, 5000)).body as Membership;
    expect(await summaryOf(id.nikos)).toMatchObject({ status: 'active', visitsLeft: 10 });
    await systemDb.update(memberships).set({ visitsUsed: 8 }).where(eq(memberships.id, sold.id));
    expect(await summaryOf(id.nikos)).toMatchObject({ status: 'expiring', visitsLeft: 2 });
    await systemDb.update(memberships).set({ visitsUsed: 7 }).where(eq(memberships.id, sold.id));
    expect(await summaryOf(id.nikos)).toMatchObject({ status: 'active', visitsLeft: 3 });
    await systemDb.update(memberships).set({ visitsUsed: 8 }).where(eq(memberships.id, sold.id));
  });

  it('filters by status', async () => {
    clock.setDay('2027-05-12');
    const frozen = await list('?status=frozen');
    expect(frozen.map((m) => m.userId)).toEqual([id.eleni]);
    // giorgos (ended 31 May, no later membership) is expired; nikos is expiring on visits.
    clock.setDay('2027-06-01');
    expect((await list('?status=expired')).map((m) => m.userId)).toEqual([id.giorgos]);
    clock.setDay('2027-05-12');
    expect((await list('?status=expiring')).map((m) => m.userId)).toEqual([id.nikos]);
    expect(await list('?status=new')).toEqual([]);
    expect((await get('/members?status=bogus', token.reception)).status).toBe(400);
    clock.setDay('2027-05-01');
  });

  it('searches names without accents or case, and phone digits; never another gym', async () => {
    expect((await list('?q=γιωργος')).map((m) => m.userId)).toEqual([id.giorgos]);
    expect((await list('?q=ΠΑΠΑΔΌΠΟΥΛΟΣ')).map((m) => m.userId)).toEqual([id.giorgos]);
    expect((await list('?q=6912')).map((m) => m.userId)).toEqual([id.giorgos]);
    expect((await list(`?q=eleni-${run}`)).map((m) => m.userId)).toEqual([id.eleni]);
    expect(await list('?q=%')).toEqual([]);
    expect(await list('?q=_')).toEqual([]);
    expect(await list('?q=Υποδοχή')).toEqual([]); // staff are not members
    expect((await list('?q=ΝΙΚΟΛΑΟΥ')).map((m) => m.userId)).toEqual([id.eleni]);
    expect((await list('?q=Άλλος')).map((m) => m.userId)).toEqual([]); // other gym
  });

  it('gives reception the member detail without payments, and the owner with them', async () => {
    const rec = await get(`/members/${id.giorgos}`, token.reception);
    expect(rec.status).toBe(200);
    const detail = rec.body as MemberDetail;
    expect(detail).toMatchObject({
      userId: id.giorgos,
      dateOfBirth: '1990-05-17',
      emergencyContactName: 'Ελένη Παπαδοπούλου',
      emergencyContactPhone: '+306987654321',
      payments: [],
    });
    expect(detail.memberships).toHaveLength(1);
    expect(detail.memberships[0]).toMatchObject({ name: 'Μηνιαία', status: 'active' });

    const own = (await get(`/members/${id.giorgos}`, token.owner)).body as MemberDetail;
    expect(own.payments).toHaveLength(1);
    expect(own.payments[0]).toMatchObject({ amountCents: 4000, memberId: id.giorgos });

    const eleni = (await get(`/members/${id.eleni}`, token.reception)).body as MemberDetail;
    expect(eleni.freezes).toHaveLength(1);
    expect(eleni.freezes[0]).toMatchObject({ startsOn: '2027-05-10', endsOn: '2027-05-16' });
  });

  it('answers 404 for someone who is not a member of this gym', async () => {
    expect((await get(`/members/${id.other}`, token.reception)).status).toBe(404);
    expect((await get(`/members/${id.reception}`, token.reception)).status).toBe(404);
    expect((await get('/members/not-a-uuid', token.reception)).status).toBe(400);
  });

  it('lets a member see only their own memberships, and not the members list', async () => {
    const mine = await get('/me/memberships', token.giorgos);
    expect(mine.status).toBe(200);
    const body = mine.body as MyMemberships;
    expect(body.memberships.map((m) => m.memberId)).toEqual([id.giorgos]);
    // eleni and nikos also hold memberships; each sees exactly theirs.
    const eleni = (await get('/me/memberships', token.eleni)).body as MyMemberships;
    expect(eleni.memberships.map((m) => m.memberId)).toEqual([id.eleni]);

    expect((await get('/members', token.giorgos)).status).toBe(403);
    expect((await get(`/members/${id.eleni}`, token.giorgos)).status).toBe(403);
    expect((await get('/me/memberships', token.reception)).status).toBe(403);
  });

  it('leaves voided memberships out of "my memberships"', async () => {
    const [p] = await systemDb.select().from(payments).where(eq(payments.memberId, id.giorgos));
    await request(server())
      .post(`/gyms/${gymId}/payments/${p!.id}/void`)
      .auth(token.owner, { type: 'bearer' })
      .send({ reason: 'Λάθος μέλος' })
      .expect(204);
    const body = (await get('/me/memberships', token.giorgos)).body as MyMemberships;
    expect(body.memberships).toEqual([]);
    // A member whose only membership was voided counts as new again.
    expect((await summaryOf(id.giorgos)).status).toBe('new');
  });
});
