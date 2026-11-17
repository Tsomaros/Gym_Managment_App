import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CheckInResult, KioskCheckInResult, Membership, MembershipType } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { hashToken } from '../src/auth/opaque-token';
import { signAccessToken } from '../src/auth/tokens';
import { signCheckInToken } from '../src/checkin/checkin-token';
import { CheckInService } from '../src/checkin/checkin.service';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  checkIns,
  devices,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  payments,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';
import { resetThrottle } from './throttle-reset';

class TestClock {
  current = new Date('2027-05-01T09:00:00Z');
  /** Added after every now(): lets two concurrent calls see different instants. */
  stepMs = 0;
  now(): Date {
    const t = this.current;
    if (this.stepMs) this.current = new Date(t.getTime() + this.stepMs);
    return t;
  }
  setDay(iso: string): void {
    this.current = new Date(`${iso}T09:00:00Z`);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('check-in (gym in Europe/Athens)', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymA: string;
  let gymB: string;
  let reception: string;
  let trainer: string;
  let ownerA: string;
  let ownerB: string;
  let deviceA: { id: string; token: string };
  let deviceA2: { id: string; token: string };
  let deviceB: { id: string; token: string };
  let trainerUserId: string;
  let packType: MembershipType;
  let monthType: MembershipType;
  let oneVisitType: MembershipType;
  const createdEmails: string[] = [];

  const server = () => app.getHttpServer();
  const sign = (id: string) => signAccessToken({ sub: id, adm: false });

  async function makeType(owner: string, gym: string, body: object): Promise<MembershipType> {
    const res = await request(server())
      .post(`/gyms/${gym}/membership-types`)
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(201);
    return res.body as MembershipType;
  }

  /** A new member of `gym`, optionally with a membership sold on the clock's current day. */
  async function makeMember(
    gym: string,
    type?: MembershipType,
    name = 'Μαρία',
  ): Promise<{ id: string; membership?: Membership }> {
    const email = `m${randomUUID().slice(0, 6)}-${run}@x.gr`;
    createdEmails.push(email);
    const [u] = await systemDb
      .insert(users)
      .values({ email, firstName: name, lastName: 'Μέλος' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: gym, userId: u!.id, role: 'member' });
    if (!type) return { id: u!.id };
    const sold = await request(server())
      .post(`/gyms/${gym}/members/${u!.id}/memberships`)
      .auth(gym === gymA ? reception : ownerB, { type: 'bearer' })
      .send({ typeId: type.id, amountCents: type.priceCents, method: 'cash' })
      .expect(201);
    return { id: u!.id, membership: sold.body as Membership };
  }

  const tokenFor = (memberId: string, gym = gymA, at = clock.current) =>
    signCheckInToken({ memberId, gymId: gym }, at).token;
  const kiosk = (token: string, device = deviceA) =>
    request(server())
      .post('/kiosk/check-in')
      .set('Authorization', `Device ${device.token}`)
      .send({ token });
  const rowsOf = (memberId: string) =>
    systemDb.select().from(checkIns).where(eq(checkIns.memberId, memberId));
  const visitsUsed = async (membershipId: string) =>
    (await systemDb.select().from(memberships).where(eq(memberships.id, membershipId)))[0]!
      .visitsUsed;

  async function makeDevice(gym: string, name: string): Promise<{ id: string; token: string }> {
    const token = `dev-${name}-${randomUUID()}`;
    const [d] = await systemDb
      .insert(devices)
      .values({ gymId: gym, name, tokenHash: hashToken(token) })
      .returning({ id: devices.id });
    return { id: d!.id, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Checkin A ${run}` }, { name: `Checkin B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const staff = await systemDb
      .insert(users)
      .values(
        ['ownera', 'rec', 'trainer', 'ownerb'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'Staff',
        })),
      )
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: staff[0]!.id, role: 'owner' },
      { gymId: gymA, userId: staff[1]!.id, role: 'reception' },
      { gymId: gymA, userId: staff[2]!.id, role: 'trainer' },
      { gymId: gymB, userId: staff[3]!.id, role: 'owner' },
    ]);
    ownerA = sign(staff[0]!.id);
    reception = sign(staff[1]!.id);
    trainer = sign(staff[2]!.id);
    trainerUserId = staff[2]!.id;
    ownerB = sign(staff[3]!.id);

    deviceA = await makeDevice(gymA, 'A');
    deviceA2 = await makeDevice(gymA, 'A2');
    deviceB = await makeDevice(gymB, 'B');

    const base = {
      priceCents: 4000,
      includesTrainer: false,
      includesClasses: false,
      maxFreezeDays: 0,
    };
    packType = await makeType(ownerA, gymA, {
      ...base,
      name: '10 επισκέψεις',
      kind: 'visits',
      visitCount: 10,
    });
    oneVisitType = await makeType(ownerA, gymA, {
      ...base,
      name: '1 επίσκεψη',
      kind: 'visits',
      visitCount: 1,
    });
    monthType = await makeType(ownerA, gymA, {
      ...base,
      name: 'Μηνιαία',
      kind: 'time',
      durationMonths: 1,
    });
  });

  beforeEach(() => {
    clock.stepMs = 0;
    clock.setDay('2027-05-01');
    resetThrottle(app);
  });

  afterAll(async () => {
    for (const id of [gymA, gymB].filter(Boolean)) {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, id));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, id));
      await systemDb.delete(payments).where(eq(payments.gymId, id));
      await systemDb.delete(memberships).where(eq(memberships.gymId, id));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, id));
      await systemDb.delete(devices).where(eq(devices.gymId, id));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, id));
      await systemDb.delete(gyms).where(eq(gyms.id, id));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('checks a pack member in at the kiosk: first name only, one visit used, one row with the device', async () => {
    const m = await makeMember(gymA, packType);
    const res = await kiosk(tokenFor(m.id)).expect(200);
    expect(res.body as KioskCheckInResult).toEqual({
      valid: true,
      firstName: 'Μαρία',
      reason: null,
    });
    expect(await visitsUsed(m.membership!.id)).toBe(1);
    const rows = await rowsOf(m.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'kiosk',
      deviceId: deviceA.id,
      gymId: gymA,
      valid: true,
      reason: null,
      visitConsumed: true,
      membershipId: m.membership!.id,
      byUserId: null,
    });
  });

  it('answers the same token 5 s later with the earlier result: one visit, one row', async () => {
    const m = await makeMember(gymA, packType);
    const token = tokenFor(m.id);
    await kiosk(token).expect(200);
    clock.advance(5000);
    const again = await kiosk(token).expect(200);
    expect((again.body as KioskCheckInResult).valid).toBe(true);
    expect(await visitsUsed(m.membership!.id)).toBe(1);
    expect(await rowsOf(m.id)).toHaveLength(1);
  });

  it('records a second check-in 3 minutes later and uses a second visit', async () => {
    const m = await makeMember(gymA, packType);
    await kiosk(tokenFor(m.id)).expect(200);
    clock.advance(3 * 60_000);
    await kiosk(tokenFor(m.id)).expect(200);
    expect(await visitsUsed(m.membership!.id)).toBe(2);
    expect(await rowsOf(m.id)).toHaveLength(2);
  });

  it('rejects a 46 s old token, a tampered token and another gym\'s member, and records nothing', async () => {
    const m = await makeMember(gymA, packType);
    const old = signCheckInToken({ memberId: m.id, gymId: gymA }, new Date(clock.current.getTime() - 46_000));
    expect((await kiosk(old.token).expect(200)).body).toEqual({
      valid: false,
      firstName: null,
      reason: 'invalid_token',
    });

    const good = tokenFor(m.id);
    const [prefix, payload, sig] = good.split('.') as [string, string, string];
    const tampered = `${prefix}.${payload.slice(0, 6)}${payload[6] === 'A' ? 'B' : 'A'}${payload.slice(7)}.${sig}`;
    expect(((await kiosk(tampered).expect(200)).body as KioskCheckInResult).reason).toBe(
      'invalid_token',
    );

    const other = await makeMember(gymB);
    const foreign = tokenFor(other.id, gymB);
    expect(((await kiosk(foreign).expect(200)).body as KioskCheckInResult).reason).toBe(
      'invalid_token',
    );
    expect(((await kiosk('garbage').expect(200)).body as KioskCheckInResult).reason).toBe(
      'invalid_token',
    );

    expect(await rowsOf(m.id)).toHaveLength(0);
    expect(await rowsOf(other.id)).toHaveLength(0);
    expect(await visitsUsed(m.membership!.id)).toBe(0);
  });

  it('answers not_member for a signed token of someone without the member role here, recording nothing', async () => {
    const res = await kiosk(tokenFor(trainerUserId)).expect(200);
    expect(res.body).toEqual({ valid: false, firstName: null, reason: 'not_member' });
    expect(await rowsOf(trainerUserId)).toHaveLength(0);
  });

  it('lets an active time membership in without consuming anything', async () => {
    const m = await makeMember(gymA, monthType);
    const res = await kiosk(tokenFor(m.id)).expect(200);
    expect((res.body as KioskCheckInResult).valid).toBe(true);
    const [row] = await rowsOf(m.id);
    expect(row).toMatchObject({ valid: true, visitConsumed: false, membershipId: m.membership!.id });
  });

  it('records an expired membership as an invalid check-in with its reason', async () => {
    const m = await makeMember(gymA, monthType);
    clock.setDay('2027-06-15');
    const res = await kiosk(tokenFor(m.id)).expect(200);
    expect(res.body).toEqual({ valid: false, firstName: 'Μαρία', reason: 'expired' });
    const [row] = await rowsOf(m.id);
    expect(row).toMatchObject({ valid: false, reason: 'expired', visitConsumed: false });
  });

  it('records a member without any membership as no_membership', async () => {
    const m = await makeMember(gymA);
    const res = await kiosk(tokenFor(m.id)).expect(200);
    expect((res.body as KioskCheckInResult).reason).toBe('no_membership');
    expect(await rowsOf(m.id)).toHaveLength(1);
  });

  it('with one visit left and two devices at once: one ok, one used_up, visits never exceed the total', async () => {
    const m = await makeMember(gymA, oneVisitType);
    const service = app.get(CheckInService);
    // Each call reads the clock once, after taking the member lock: the second sees +3 minutes,
    // so the 2-minute duplicate rule cannot hide the race.
    clock.stepMs = 3 * 60_000;
    const results = await Promise.all([
      service.checkIn({ gymId: gymA, memberId: m.id, method: 'kiosk', deviceId: deviceA.id }),
      service.checkIn({ gymId: gymA, memberId: m.id, method: 'kiosk', deviceId: deviceA2.id }),
    ]);
    clock.stepMs = 0;
    expect(results.map((r) => r.valid).sort()).toEqual([false, true]);
    expect(results.find((r) => !r.valid)!.reason).toBe('used_up');
    expect(await visitsUsed(m.membership!.id)).toBe(1);
    const rows = await rowsOf(m.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.visitConsumed)).toHaveLength(1);
  });

  describe('manual check-in by reception', () => {
    const manual = (token: string, member: string, gym = gymA) =>
      request(server())
        .post(`/gyms/${gym}/members/${member}/check-ins`)
        .auth(token, { type: 'bearer' });

    it('records method manual with the receptionist, writes history and returns the full result', async () => {
      const m = await makeMember(gymA, packType, 'Γιώργος');
      const res = await manual(reception, m.id).expect(201);
      const body = res.body as CheckInResult;
      expect(body).toMatchObject({
        valid: true,
        reason: null,
        duplicate: false,
        member: { id: m.id, firstName: 'Γιώργος', lastName: 'Μέλος', photoUrl: null },
        membership: { id: m.membership!.id },
      });
      expect(body.checkInId).toEqual(expect.any(String));
      expect(await visitsUsed(m.membership!.id)).toBe(1);

      const [row] = await rowsOf(m.id);
      expect(row).toMatchObject({ method: 'manual', deviceId: null });
      expect(row!.byUserId).not.toBeNull();
      const history = await systemDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.gymId, gymA), eq(auditLog.action, 'check_in.manual')));
      expect(history.some((h) => h.entityId === m.id)).toBe(true);
    });

    it('flags a second manual check-in within 2 minutes as a duplicate and records nothing new', async () => {
      const m = await makeMember(gymA, packType);
      const first = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      clock.advance(30_000);
      const second = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      expect(second).toMatchObject({ duplicate: true, valid: true, checkInId: first.checkInId });
      expect(await visitsUsed(m.membership!.id)).toBe(1);
      expect(await rowsOf(m.id)).toHaveLength(1);
    });

    it('the 2-minute window: 119 s later is still a duplicate, exactly 120 s later is a new check-in', async () => {
      const m = await makeMember(gymA, packType);
      const first = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      clock.advance(119_000);
      const near = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      expect(near).toMatchObject({ duplicate: true, checkInId: first.checkInId });
      expect(await rowsOf(m.id)).toHaveLength(1);
      // The window is measured from the stored first check-in (09:00:00), not from the repeat.
      clock.advance(1_000);
      const later = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      expect(later.duplicate).toBe(false);
      expect(later.checkInId).not.toBe(first.checkInId);
      expect(await visitsUsed(m.membership!.id)).toBe(2);
      expect(await rowsOf(m.id)).toHaveLength(2);
    });

    it('a different member checking in within the window is not a duplicate', async () => {
      const a = await makeMember(gymA, packType);
      const b = await makeMember(gymA, packType);
      await manual(reception, a.id).expect(201);
      clock.advance(5_000);
      const res = (await manual(reception, b.id).expect(201)).body as CheckInResult;
      expect(res).toMatchObject({ duplicate: false, valid: true, member: { id: b.id } });
      expect(await visitsUsed(b.membership!.id)).toBe(1);
      expect(await rowsOf(b.id)).toHaveLength(1);
    });

    it('a repeated refused check-in within the window repeats the refusal and stores no second row', async () => {
      const m = await makeMember(gymA);
      const first = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      expect(first).toMatchObject({ valid: false, reason: 'no_membership', duplicate: false });
      clock.advance(10_000);
      const second = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      expect(second).toMatchObject({
        valid: false,
        reason: 'no_membership',
        duplicate: true,
        checkInId: first.checkInId,
      });
      expect(await rowsOf(m.id)).toHaveLength(1);
    });

    it('honours a sale made right after a refusal: the refusal does not block the real check-in', async () => {
      const m = await makeMember(gymA);
      const refused = await kiosk(tokenFor(m.id)).expect(200);
      expect((refused.body as KioskCheckInResult).reason).toBe('no_membership');
      await request(server())
        .post(`/gyms/${gymA}/members/${m.id}/memberships`)
        .auth(reception, { type: 'bearer' })
        .send({ typeId: packType.id, amountCents: 4000, method: 'cash' })
        .expect(201);
      clock.advance(10_000);
      const body = (await manual(reception, m.id).expect(201)).body as CheckInResult;
      expect(body).toMatchObject({ valid: true, duplicate: false, reason: null });
      const rows = await rowsOf(m.id);
      expect(rows.map((r) => r.valid).sort()).toEqual([false, true]);
    });

    it('returns the reason and the membership for an invalid manual check-in', async () => {
      const m = await makeMember(gymA, monthType);
      clock.setDay('2027-06-15');
      const body = (await manual(ownerA, m.id).expect(201)).body as CheckInResult;
      expect(body).toMatchObject({
        valid: false,
        reason: 'expired',
        membership: { id: m.membership!.id },
      });
    });

    it('answers 403 to a trainer, 404 to someone who is not a member of this gym', async () => {
      const m = await makeMember(gymA, packType);
      await manual(trainer, m.id).expect(403);
      const outsider = await makeMember(gymB);
      await manual(reception, outsider.id).expect(404);
      await manual(reception, trainerUserId).expect(404);
      await manual(ownerB, m.id, gymA).expect(403);
      expect(await rowsOf(m.id)).toHaveLength(0);
      expect(await rowsOf(outsider.id)).toHaveLength(0);
    });
  });

  it('refuses a gym B device for gym A members (cross-gym) and a revoked or unknown device', async () => {
    const m = await makeMember(gymA, packType);
    const res = await kiosk(tokenFor(m.id, gymA), deviceB).expect(200);
    expect((res.body as KioskCheckInResult).reason).toBe('invalid_token');
    await kiosk(tokenFor(m.id), { id: 'x', token: 'unknown' }).expect(401);
    await request(server()).post('/kiosk/check-in').send({ token: tokenFor(m.id) }).expect(401);
    expect(await rowsOf(m.id)).toHaveLength(0);
  });

  it('answers 429 to the 61st kiosk check-in of one device within 60 s, while another device still works', async () => {
    for (let i = 0; i < 60; i++) await kiosk('garbage', deviceA2).expect(200);
    await kiosk('garbage', deviceA2).expect(429);
    await kiosk('garbage', deviceA).expect(200);
  });
});
