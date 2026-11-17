import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  CheckInResult,
  MembershipType,
  PresentMember,
  VisitorRow,
} from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  checkIns,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  payments,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';

/** Athens is UTC+3 in May 2027 (summer time). */
const at = (day: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60_000);
};

class TestClock {
  current = new Date();
  now(): Date {
    return this.current;
  }
}

describe('who is in, visitors and check-out (gym in Europe/Athens, auto check-out 120)', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let reception: string;
  let trainer: string;
  let ownerToken: string;
  let monthly: MembershipType;
  const server = () => app.getHttpServer();

  async function makeMember(name: string, withMembership = true): Promise<string> {
    const [u] = await systemDb
      .insert(users)
      .values({
        email: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}-${run}@x.gr`,
        firstName: name,
        lastName: 'Μέλος',
      })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId, userId: u!.id, role: 'member' });
    if (withMembership) {
      clock.current = at('2027-05-01', '08:00');
      await request(server())
        .post(`/gyms/${gymId}/members/${u!.id}/memberships`)
        .auth(reception, { type: 'bearer' })
        .send({ typeId: monthly.id, amountCents: 4000, method: 'cash' })
        .expect(201);
    }
    return u!.id;
  }

  /** A manual check-in by reception at the given gym-local time. */
  async function checkInAt(memberId: string, day: string, hhmm: string): Promise<CheckInResult> {
    clock.current = at(day, hhmm);
    return (
      await request(server())
        .post(`/gyms/${gymId}/members/${memberId}/check-ins`)
        .auth(reception, { type: 'bearer' })
        .expect(201)
    ).body as CheckInResult;
  }

  const present = async (token = reception): Promise<PresentMember[]> =>
    (
      await request(server())
        .get(`/gyms/${gymId}/check-ins/present`)
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as PresentMember[];
  const visitors = async (date?: string): Promise<VisitorRow[]> =>
    (
      await request(server())
        .get(`/gyms/${gymId}/check-ins${date ? `?date=${date}` : ''}`)
        .auth(reception, { type: 'bearer' })
        .expect(200)
    ).body as VisitorRow[];
  const checkOut = (id: string, token = reception) =>
    request(server())
      .post(`/gyms/${gymId}/check-ins/${id}/check-out`)
      .auth(token, { type: 'bearer' });
  const ids = (list: { memberId: string }[]) => list.map((p) => p.memberId);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Presence ${run}`, timezone: 'Europe/Athens' })
      .returning({ id: gyms.id });
    gymId = g!.id;
    const staff = await systemDb
      .insert(users)
      .values(
        ['owner', 'rec', 'trainer'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'Staff',
        })),
      )
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId, userId: staff[0]!.id, role: 'owner' },
      { gymId, userId: staff[1]!.id, role: 'reception' },
      { gymId, userId: staff[2]!.id, role: 'trainer' },
    ]);
    const sign = (id: string) => signAccessToken({ sub: id, adm: false });
    ownerToken = sign(staff[0]!.id);
    reception = sign(staff[1]!.id);
    trainer = sign(staff[2]!.id);

    monthly = (
      await request(server())
        .post(`/gyms/${gymId}/membership-types`)
        .auth(ownerToken, { type: 'bearer' })
        .send({
          name: 'Μηνιαία',
          kind: 'time',
          durationMonths: 12,
          priceCents: 4000,
          maxFreezeDays: 0,
        })
        .expect(201)
    ).body as MembershipType;
  });

  beforeEach(() => {
    clock.current = at('2027-05-01', '09:00');
  });

  afterAll(async () => {
    if (gymId) {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, gymId));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, gymId));
      await systemDb.delete(payments).where(eq(payments.gymId, gymId));
      await systemDb.delete(memberships).where(eq(memberships.gymId, gymId));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, gymId));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
      await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('shows a 10:00 check-in at 12:00 (exactly 120 min) and not at 12:01', async () => {
    const m = await makeMember('Ένα');
    await checkInAt(m, '2027-05-02', '10:00');
    clock.current = at('2027-05-02', '12:00');
    expect(ids(await present())).toContain(m);
    clock.current = at('2027-05-02', '12:01');
    expect(ids(await present())).not.toContain(m);
  });

  it('does not show a 23:30 check-in at 00:10 the next gym day, although only 40 minutes passed', async () => {
    const m = await makeMember('Δύο');
    await checkInAt(m, '2027-05-03', '23:30');
    clock.current = at('2027-05-03', '23:59');
    expect(ids(await present())).toContain(m);
    clock.current = at('2027-05-04', '00:10');
    expect(ids(await present())).not.toContain(m);
  });

  it('lists a member who checked in twice once, with the later check-in', async () => {
    const m = await makeMember('Τρία');
    await checkInAt(m, '2027-05-05', '11:00');
    const second = await checkInAt(m, '2027-05-05', '11:30');
    expect(second.duplicate).toBe(false);
    clock.current = at('2027-05-05', '11:45');
    const list = (await present()).filter((p) => p.memberId === m);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      checkInId: second.checkInId,
      firstName: 'Τρία',
      lastName: 'Μέλος',
      photoUrl: null,
      membershipStatus: 'active',
    });
    expect(list[0]!.at).toBe(at('2027-05-05', '11:30').toISOString());
  });

  it('lists the newest first', async () => {
    const a = await makeMember('Άλφα');
    const b = await makeMember('Βήτα');
    await checkInAt(a, '2027-05-06', '10:00');
    await checkInAt(b, '2027-05-06', '10:30');
    clock.current = at('2027-05-06', '10:40');
    const order = ids(await present()).filter((id) => id === a || id === b);
    expect(order).toEqual([b, a]);
  });

  it('keeps refused check-ins out of "inside" but shows them to reception with the reason', async () => {
    const m = await makeMember('Τέσσερα', false);
    const result = await checkInAt(m, '2027-05-07', '10:00');
    expect(result).toMatchObject({ valid: false, reason: 'no_membership' });
    clock.current = at('2027-05-07', '10:05');
    expect(ids(await present())).not.toContain(m);
    const row = (await visitors('2027-05-07')).find((v) => v.memberId === m)!;
    expect(row).toMatchObject({
      checkInId: result.checkInId,
      firstName: 'Τέσσερα',
      method: 'manual',
      valid: false,
      reason: 'no_membership',
      checkedOutAt: null,
    });
  });

  it('lists one day of visitors: the date asked for, defaulting to today in gym time', async () => {
    const m = await makeMember('Πέντε');
    await checkInAt(m, '2027-05-08', '23:50');
    await checkInAt(m, '2027-05-09', '00:20');
    clock.current = at('2027-05-09', '09:00');
    const day8 = (await visitors('2027-05-08')).filter((v) => v.memberId === m);
    const day9 = (await visitors('2027-05-09')).filter((v) => v.memberId === m);
    expect(day8.map((v) => v.at)).toEqual([at('2027-05-08', '23:50').toISOString()]);
    expect(day9.map((v) => v.at)).toEqual([at('2027-05-09', '00:20').toISOString()]);
    expect((await visitors()).filter((v) => v.memberId === m)).toEqual(day9);
    await request(server())
      .get(`/gyms/${gymId}/check-ins?date=2027-13-45`)
      .auth(reception, { type: 'bearer' })
      .expect(400);
  });

  it('checks a visitor out: gone from "inside"; a second check-out is 409; a trainer gets 403', async () => {
    const m = await makeMember('Έξι');
    const result = await checkInAt(m, '2027-05-10', '10:00');
    clock.current = at('2027-05-10', '10:30');
    await checkOut(result.checkInId!, trainer).expect(403);
    expect(ids(await present())).toContain(m);

    await checkOut(result.checkInId!).expect(204);
    expect(ids(await present())).not.toContain(m);
    await checkOut(result.checkInId!).expect(409);
    await checkOut(randomUUID()).expect(404);

    const row = (await visitors('2027-05-10')).find((v) => v.memberId === m)!;
    expect(row.checkedOutAt).toBe(at('2027-05-10', '10:30').toISOString());
    const history = await systemDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.checkInId!));
    expect(history.map((h) => h.action)).toEqual(['check_in.checked_out']);
  });

  it('refuses to check out a refused check-in: nobody was inside, so nothing is recorded or pushed', async () => {
    const m = await makeMember('Άκυρος', false);
    const refused = await checkInAt(m, '2027-05-15', '10:00');
    expect(refused.valid).toBe(false);
    await checkOut(refused.checkInId!).expect(409);
    const history = await systemDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, refused.checkInId!));
    expect(history).toEqual([]);
    expect((await visitors('2027-05-15')).find((v) => v.memberId === m)!.checkedOutAt).toBeNull();
  });

  it('lets a member who was checked out come in again at once (no duplicate window)', async () => {
    const m = await makeMember('Εφτά');
    const first = await checkInAt(m, '2027-05-11', '10:00');
    clock.current = at('2027-05-11', '10:00');
    await checkOut(first.checkInId!).expect(204);
    const again = await checkInAt(m, '2027-05-11', '10:01');
    expect(again).toMatchObject({ duplicate: false, valid: true });
    expect(again.checkInId).not.toBe(first.checkInId);
    expect(ids(await present())).toContain(m);
  });

  it('lets a trainer see who is inside but not the day\'s visitors, and a member nothing', async () => {
    const m = await makeMember('Οκτώ');
    await checkInAt(m, '2027-05-12', '10:00');
    clock.current = at('2027-05-12', '10:10');
    expect(ids(await present(trainer))).toContain(m);
    await request(server())
      .get(`/gyms/${gymId}/check-ins`)
      .auth(trainer, { type: 'bearer' })
      .expect(403);
    await request(server())
      .get(`/gyms/${gymId}/check-ins/present`)
      .expect(401);
  });

  it('defaults the visitor list to today in gym time, not UTC (00:30 Athens is still yesterday in UTC)', async () => {
    const m = await makeMember('Δέκα');
    await checkInAt(m, '2027-05-14', '00:20'); // 2027-05-13T21:20Z
    clock.current = at('2027-05-14', '00:30'); // 21:30Z on the 13th
    expect((await visitors()).map((v) => v.memberId)).toContain(m);
    expect((await visitors('2027-05-13')).map((v) => v.memberId)).not.toContain(m);
  });

  it('never shows or checks out another gym\'s visitors', async () => {
    const [other] = await systemDb
      .insert(gyms)
      .values({ name: `Presence other ${run}`, timezone: 'Europe/Athens' })
      .returning({ id: gyms.id });
    try {
      const [u] = await systemDb
        .insert(users)
        .values({ email: `foreign-${run}@x.gr`, firstName: 'Ξένος', lastName: 'Μέλος' })
        .returning({ id: users.id });
      await systemDb.insert(gymRoles).values({ gymId: other!.id, userId: u!.id, role: 'member' });
      const [ci] = await systemDb
        .insert(checkIns)
        .values({
          gymId: other!.id,
          memberId: u!.id,
          at: at('2027-05-15', '10:00'),
          method: 'manual',
          valid: true,
        })
        .returning({ id: checkIns.id });
      clock.current = at('2027-05-15', '10:10');
      expect(ids(await present())).not.toContain(u!.id);
      expect(ids(await visitors('2027-05-15'))).not.toContain(u!.id);
      await checkOut(ci!.id).expect(404);
      const [after] = await systemDb.select().from(checkIns).where(eq(checkIns.id, ci!.id));
      expect(after!.checkedOutAt).toBeNull();
    } finally {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, other!.id));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, other!.id));
      await systemDb.delete(gyms).where(eq(gyms.id, other!.id));
    }
  });

  it('changes who is inside when the owner changes the auto check-out minutes', async () => {
    const m = await makeMember('Εννιά');
    await checkInAt(m, '2027-05-13', '10:00');
    clock.current = at('2027-05-13', '11:00');
    expect(ids(await present())).toContain(m);
    await request(server())
      .patch(`/gyms/${gymId}/settings`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ autoCheckoutMinutes: 30 })
      .expect(200);
    expect(ids(await present())).not.toContain(m);
    await request(server())
      .patch(`/gyms/${gymId}/settings`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ autoCheckoutMinutes: 120 })
      .expect(200);
  });
});
