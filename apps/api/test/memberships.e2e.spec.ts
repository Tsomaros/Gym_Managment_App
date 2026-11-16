import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Membership, MembershipType, Payment } from '@gym/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  payments,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';

/** A clock the test moves by hand. */
class TestClock {
  current = new Date('2027-01-31T10:00:00Z');
  now(): Date {
    return this.current;
  }
}

describe('selling memberships, payments and voiding (gym in Europe/Athens)', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  const id = { owner: '', reception: '', member: '', member2: '', outsider: '' };
  const token = { owner: '', reception: '', trainer: '' };
  const type: Record<'monthly' | 'dayPass' | 'tenVisits', MembershipType> = {} as never;

  const server = () => app.getHttpServer();
  const sell = (memberId: string, body: Record<string, unknown>, bearer = token.reception) =>
    request(server())
      .post(`/gyms/${gymId}/members/${memberId}/memberships`)
      .auth(bearer, { type: 'bearer' })
      .send({ method: 'cash', ...body });
  const listPayments = (from: string, to: string, bearer = token.owner) =>
    request(server())
      .get(`/gyms/${gymId}/payments?from=${from}&to=${to}`)
      .auth(bearer, { type: 'bearer' });
  const voidPayment = (paymentId: string, bearer = token.owner, reason = 'Λάθος ποσό') =>
    request(server())
      .post(`/gyms/${gymId}/payments/${paymentId}/void`)
      .auth(bearer, { type: 'bearer' })
      .send({ reason });
  const createType = async (body: Record<string, unknown>) => {
    const res = await request(server())
      .post(`/gyms/${gymId}/membership-types`)
      .auth(token.owner, { type: 'bearer' })
      .send(body);
    expect(res.status).toBe(201);
    return res.body as MembershipType;
  };

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
        { name: `Sell ${run}`, timezone: 'Europe/Athens' },
        { name: `Other ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = g[0]!.id;
    otherGymId = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `owner-${run}@x.gr`, firstName: 'Νίκος', lastName: 'Ιδιοκτήτης' },
        { email: `rec-${run}@x.gr`, firstName: 'Μαρία', lastName: 'Υποδοχή' },
        { email: `mem-${run}@x.gr`, firstName: 'Γιώργος', lastName: 'Μέλος' },
        { email: `mem2-${run}@x.gr`, firstName: 'Ελένη', lastName: 'Μέλος' },
        { email: `out-${run}@x.gr`, firstName: 'Ξένος', lastName: 'Άλλου' },
        { email: `tr-${run}@x.gr`, firstName: 'Κώστας', lastName: 'Γυμναστής' },
      ])
      .returning({ id: users.id });
    [id.owner, id.reception, id.member, id.member2, id.outsider] = u.map((r) => r.id) as [
      string,
      string,
      string,
      string,
      string,
    ];
    const trainerId = u[5]!.id;
    await systemDb.insert(gymRoles).values([
      { gymId, userId: id.owner, role: 'owner' },
      { gymId, userId: id.reception, role: 'reception' },
      { gymId, userId: id.member, role: 'member' },
      { gymId, userId: id.member2, role: 'member' },
      { gymId, userId: trainerId, role: 'trainer' },
      // A member of another gym only.
      { gymId: otherGymId, userId: id.outsider, role: 'member' },
    ]);
    token.owner = signAccessToken({ sub: id.owner, adm: false });
    token.reception = signAccessToken({ sub: id.reception, adm: false });
    token.trainer = signAccessToken({ sub: trainerId, adm: false });

    type.monthly = await createType({
      name: 'Μηνιαία',
      kind: 'time',
      durationMonths: 1,
      priceCents: 4000,
      maxFreezeDays: 14,
      includesTrainer: true,
    });
    type.dayPass = await createType({ name: 'Ημερήσια', kind: 'day_pass', priceCents: 800 });
    type.tenVisits = await createType({
      name: 'Δεκάρα',
      kind: 'visits',
      visitCount: 10,
      priceCents: 5000,
    });
  });

  beforeEach(() => {
    clock.current = new Date('2027-01-31T10:00:00Z');
  });

  afterAll(async () => {
    const gymIds = [gymId, otherGymId].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(auditLog).where(inArray(auditLog.gymId, gymIds));
      await systemDb.delete(payments).where(inArray(payments.gymId, gymIds));
      await systemDb.delete(memberships).where(inArray(memberships.gymId, gymIds));
      await systemDb.delete(membershipTypes).where(inArray(membershipTypes.gymId, gymIds));
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  let first: Membership;

  it('sells a 1-month membership starting today: 31 January ends on 28 February', async () => {
    const res = await sell(id.member, { typeId: type.monthly.id, amountCents: 4000 });
    expect(res.status).toBe(201);
    first = res.body as Membership;
    expect(first).toMatchObject({
      memberId: id.member,
      typeId: type.monthly.id,
      name: 'Μηνιαία',
      kind: 'time',
      includesTrainer: true,
      priceCents: 4000,
      startsOn: '2027-01-31',
      endsOn: '2027-02-28',
      effectiveEndsOn: '2027-02-28',
      status: 'active',
      remaining: { days: 29, visits: null },
    });

    const paid = await systemDb.select().from(payments).where(eq(payments.membershipId, first.id));
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amountCents: 4000, method: 'cash', recordedBy: id.reception });

    const sold = await systemDb
      .select()
      .from(auditLog)
      .where(sql`${auditLog.entityId} = ${first.id} and ${auditLog.action} = 'membership.sold'`);
    expect(sold).toHaveLength(1);
    expect(sold[0]!.actorId).toBe(id.reception);
    expect(sold[0]!.data).toMatchObject({
      typeName: 'Μηνιαία',
      amountCents: 4000,
      method: 'cash',
      startsOn: '2027-01-31',
      endsOn: '2027-02-28',
    });
  });

  it('starts an early renewal the day after the current one ends', async () => {
    const res = await sell(id.member, {
      typeId: type.monthly.id,
      amountCents: 3500,
      method: 'card',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      startsOn: '2027-03-01',
      endsOn: '2027-03-31',
      status: 'upcoming',
      priceCents: 4000, // the type's price; the discount is in the payment
    });
  });

  it('uses "today" in Athens, not UTC: 22:30 UTC on 31 January is already 1 February', async () => {
    clock.current = new Date('2027-01-31T22:30:00Z');
    const res = await sell(id.member2, { typeId: type.dayPass.id, amountCents: 800 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startsOn: '2027-02-01', endsOn: '2027-02-01' });
  });

  it('keeps the sold name and price after the type is edited and archived; archived types cannot be sold', async () => {
    const before = await systemDb.select().from(memberships).where(eq(memberships.id, first.id));
    await request(server())
      .patch(`/gyms/${gymId}/membership-types/${type.monthly.id}`)
      .auth(token.owner, { type: 'bearer' })
      .send({ name: 'Μηνιαία νέα', kind: 'time', durationMonths: 1, priceCents: 4500 })
      .expect(200);
    await request(server())
      .post(`/gyms/${gymId}/membership-types/${type.monthly.id}/archive`)
      .auth(token.owner, { type: 'bearer' })
      .expect(204);

    const [after] = await systemDb.select().from(memberships).where(eq(memberships.id, first.id));
    expect(after).toMatchObject({
      name: 'Μηνιαία',
      priceCents: 4000,
      includesTrainer: true,
      maxFreezeDays: 14,
    });
    expect(after).toEqual(before[0]);

    const res = await sell(id.member2, { typeId: type.monthly.id, amountCents: 4500 });
    expect(res.status).toBe(409);
  });

  it('sells a day pass for today with one visit, and a 10-visit pack with no end date', async () => {
    const day = await sell(id.member2, { typeId: type.dayPass.id, amountCents: 800 });
    expect(day.body).toMatchObject({
      kind: 'day_pass',
      startsOn: '2027-01-31',
      endsOn: '2027-01-31',
      visitsTotal: 1,
      visitsUsed: 0,
      status: 'active',
    });

    const pack = await sell(id.member2, { typeId: type.tenVisits.id, amountCents: 5000 });
    expect(pack.body).toMatchObject({
      kind: 'visits',
      startsOn: '2027-01-31',
      endsOn: null,
      effectiveEndsOn: null,
      visitsTotal: 10,
      remaining: { days: null, visits: 10 },
    });
  });

  it('sells a visit pack with a validity period ending validity-1 days after the start', async () => {
    const pack = await createType({
      name: 'Τρίμηνη δεκάρα',
      kind: 'visits',
      visitCount: 10,
      validityDays: 90,
      priceCents: 6000,
    });
    const res = await sell(id.member2, { typeId: pack.id, amountCents: 6000 });
    expect(res.body).toMatchObject({ startsOn: '2027-01-31', endsOn: '2027-04-30' });
  });

  it('honours a chosen future start date', async () => {
    const res = await sell(id.member2, {
      typeId: type.tenVisits.id,
      amountCents: 5000,
      startsOn: '2027-02-15',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startsOn: '2027-02-15', status: 'upcoming' });
  });

  it('refuses a person who is not a member of this gym (404), a past start (400) and a trainer (403)', async () => {
    expect((await sell(id.outsider, { typeId: type.dayPass.id, amountCents: 800 })).status).toBe(
      404,
    );
    // Staff without the member role can't be sold a membership either.
    expect((await sell(id.reception, { typeId: type.dayPass.id, amountCents: 800 })).status).toBe(
      404,
    );
    expect(
      (
        await sell(id.member, {
          typeId: type.dayPass.id,
          amountCents: 800,
          startsOn: '2027-01-30',
        })
      ).status,
    ).toBe(400);
    expect(
      (await sell(id.member, { typeId: type.dayPass.id, amountCents: 800 }, token.trainer)).status,
    ).toBe(403);
    expect((await sell(id.member, { typeId: randomUUID(), amountCents: 800 })).status).toBe(404);
    expect((await sell(id.member, { typeId: type.dayPass.id, amountCents: -1 })).status).toBe(400);
  });

  it('refuses an amount above the type price (400) but accepts a discount', async () => {
    expect((await sell(id.member2, { typeId: type.dayPass.id, amountCents: 801 })).status).toBe(
      400,
    );
    expect((await sell(id.member2, { typeId: type.dayPass.id, amountCents: 0 })).status).toBe(201);
  });

  it('refuses a payments range longer than 366 days or reversed (400)', async () => {
    expect((await listPayments('2027-01-01', '2028-01-02')).status).toBe(400);
    expect((await listPayments('2027-02-01', '2027-01-31')).status).toBe(400);
    expect((await listPayments('2027-01-01', '2028-01-01')).status).toBe(200);
  });

  it('lists the day’s payments for the owner with member and recorder names; reception gets 403', async () => {
    const res = await listPayments('2027-01-31', '2027-01-31');
    expect(res.status).toBe(200);
    const list = res.body as Payment[];
    const forFirst = list.filter((p) => p.membershipId === first.id);
    expect(forFirst).toHaveLength(1);
    expect(forFirst[0]).toMatchObject({
      amountCents: 4000,
      method: 'cash',
      memberId: id.member,
      memberName: 'Γιώργος Μέλος',
      recordedBy: { id: id.reception, fullName: 'Μαρία Υποδοχή' },
      voidedAt: null,
    });
    // The renewal paid by card on the same day is there too.
    expect(list.some((p) => p.memberId === id.member && p.method === 'card')).toBe(true);
    const nextDay = (await listPayments('2027-02-01', '2027-02-01')).body as Payment[];
    expect(nextDay.map((p) => p.membershipId)).not.toContain(first.id);
    // The day pass sold at 22:30 UTC on 31 January belongs to 1 February in Athens.
    expect(nextDay.some((p) => p.memberId === id.member2 && p.amountCents === 800)).toBe(true);

    expect((await listPayments('2027-01-31', '2027-01-31', token.reception)).status).toBe(403);
  });

  it('voids a payment and its membership; voiding again is 409; reception may not void', async () => {
    const [payment] = (await listPayments('2027-01-31', '2027-01-31')).body.filter(
      (p: Payment) => p.membershipId === first.id,
    ) as Payment[];

    expect((await voidPayment(payment!.id, token.reception)).status).toBe(403);
    expect((await voidPayment(payment!.id, token.owner, 'no')).status).toBe(400);

    const res = await voidPayment(payment!.id);
    expect(res.status).toBe(204);

    const [m] = await systemDb.select().from(memberships).where(eq(memberships.id, first.id));
    expect(m!.voidedAt).not.toBeNull();
    const [p] = await systemDb.select().from(payments).where(eq(payments.id, payment!.id));
    expect(p).toMatchObject({ voidedBy: id.owner, voidReason: 'Λάθος ποσό' });

    const listed = (await listPayments('2027-01-31', '2027-01-31')).body as Payment[];
    expect(listed.find((x) => x.id === payment!.id)).toMatchObject({
      voidedBy: { id: id.owner, fullName: 'Νίκος Ιδιοκτήτης' },
      voidReason: 'Λάθος ποσό',
    });

    const history = await systemDb
      .select()
      .from(auditLog)
      .where(sql`${auditLog.entityId} = ${payment!.id} and ${auditLog.action} = 'payment.voided'`);
    expect(history).toHaveLength(1);

    expect((await voidPayment(payment!.id)).status).toBe(409);
  });

  it('a time membership sold after the member’s only one was voided starts today, not the day after it', async () => {
    // member2 has no time membership yet (only a day pass and packs), so this is self-contained.
    const time = await createType({
      name: 'Μηνιαία Β',
      kind: 'time',
      durationMonths: 1,
      priceCents: 4000,
    });
    const a = await sell(id.member2, { typeId: time.id, amountCents: 4000 });
    expect(a.body).toMatchObject({ startsOn: '2027-01-31', endsOn: '2027-02-28' });
    // Without a void, a second sale would start on 2027-03-01 (see the early-renewal test).
    const [pay] = await systemDb
      .select()
      .from(payments)
      .where(eq(payments.membershipId, a.body.id));
    expect((await voidPayment(pay!.id)).status).toBe(204);

    const b = await sell(id.member2, { typeId: time.id, amountCents: 4000 });
    expect(b.body).toMatchObject({
      startsOn: '2027-01-31',
      endsOn: '2027-02-28',
      status: 'active',
    });
  });

  it('voiding an unknown payment is 404', async () => {
    expect((await voidPayment(randomUUID())).status).toBe(404);
  });
});
