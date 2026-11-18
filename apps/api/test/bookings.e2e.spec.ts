import type { Attendee, BookingView, ClassSessionView, ClassTypeView, MembershipType } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  classBookings,
  classSeries,
  classSessions,
  classTypes,
  gymRoles,
  memberships,
  users,
} from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** Athens is UTC+3 in May 2027. The fixture clock starts at DAY 12:00 local (09:00Z). */
const local = (day: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60_000);
};

describe('class bookings: capacity, reservations, cancellation rules', () => {
  let f: HealthFixture;
  let spinning: ClassTypeView;
  let packType: MembershipType;
  let timeType: MembershipType;

  async function newMember(name: string): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${name}-${f.run}@x.gr`, firstName: name, lastName: 'Member' })
      .returning({ id: users.id });
    f.id[name] = u!.id;
    f.tok[name] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
  }
  const sell = (member: string, typeId: string, price = 1000) =>
    f
      .req('post', `/members/${f.id[member]}/memberships`, 'rec')
      .send({ typeId, amountCents: price, method: 'cash', startsOn: DAY })
      .expect(201);
  async function mk(
    date: string,
    startsAt: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const r = await f
      .req('post', '/class-sessions', 'owner')
      .send({
        classTypeId: spinning.id,
        date,
        startsAt,
        durationMinutes: 45,
        capacity: 10,
        ...over,
      })
      .expect(201);
    return (r.body as { id: string }).id;
  }
  const book = (who: string, sessionId: string, body: Record<string, unknown> = {}) =>
    f.req('post', `/class-sessions/${sessionId}/bookings`, who).send(body);
  const bookings = async (sessionId: string) =>
    systemDb.select().from(classBookings).where(eq(classBookings.sessionId, sessionId));
  const used = async (member: string) =>
    (
      await systemDb
        .select({ u: memberships.visitsUsed })
        .from(memberships)
        .where(
          and(eq(memberships.memberId, f.id[member]!), eq(memberships.kind, 'classes')),
        )
    ).map((r) => r.u);

  beforeAll(async () => {
    f = await setupHealthFixture('Bookings');
    spinning = (
      await f
        .req('post', '/class-types', 'owner')
        .send({ name: 'Spinning', defaultCapacity: 10, defaultDurationMinutes: 45 })
        .expect(201)
    ).body as ClassTypeView;
    packType = (
      await f
        .req('post', '/membership-types', 'owner')
        .send({ name: 'Πακέτο', kind: 'classes', visitCount: 1, priceCents: 1000, includesClasses: true })
        .expect(201)
    ).body as MembershipType;
    timeType = (
      await f
        .req('post', '/membership-types', 'owner')
        .send({
          name: 'Με μαθήματα',
          kind: 'time',
          durationMonths: 3,
          priceCents: 1000,
          maxFreezeDays: 0,
          includesClasses: true,
        })
        .expect(201)
    ).body as MembershipType;
    for (const n of ['p', 'q']) await newMember(n);
  });

  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(classBookings).where(eq(classBookings.gymId, g));
      await systemDb.delete(classSessions).where(eq(classSessions.gymId, g));
      await systemDb.delete(classSeries).where(eq(classSeries.gymId, g));
      await systemDb.delete(classTypes).where(eq(classTypes.gymId, g));
    });
  });

  it('a class pack with one entry: one future class booked, a second refused, on-time cancel frees it, late cancel consumes it', async () => {
    await sell('m', packType.id);
    const a = await mk('2027-05-12', '18:00');
    const b = await mk('2027-05-12', '20:00');
    await book('m', a).expect(201);
    await book('m', b).expect(409);
    // 6 h before: free. Rebooking another class works.
    const cancelled = await f.req('delete', `/me/bookings/${(await bookings(a))[0]!.id}`, 'm').expect(200);
    expect(cancelled.body).toEqual({ status: 'cancelled' });
    expect(await used('m')).toEqual([0]);
    await book('m', b).expect(201);
    // 1 h before the 20:00 class: late, the entry is consumed.
    f.clock.current = local('2027-05-12', '19:00');
    const late = await f.req('delete', `/me/bookings/${(await bookings(b))[0]!.id}`, 'm').expect(200);
    expect(late.body).toEqual({ status: 'late_cancelled' });
    expect(await used('m')).toEqual([1]);
    const row = (await bookings(b))[0]!;
    expect(row).toMatchObject({ status: 'late_cancelled', entryConsumed: true });
    // The pack is used up now.
    f.clock.setDay(DAY);
    const c = await mk('2027-05-13', '10:00');
    await book('m', c).expect(409);
  });

  it('the last spot goes to one of two members booking at the same moment', async () => {
    await sell('n', timeType.id);
    await sell('p', timeType.id);
    const s = await mk('2027-05-13', '09:00', { capacity: 1 });
    const res = await Promise.all([book('n', s), book('p', s)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.message).toBe('Class full');
    expect((await bookings(s)).filter((b) => b.status === 'booked')).toHaveLength(1);
    const day = (await f.req('get', '/class-sessions?from=2027-05-13&to=2027-05-13', 'owner').expect(200))
      .body as ClassSessionView[];
    expect(day.find((x) => x.id === s)).toMatchObject({ booked: 1, capacity: 1 });
  });

  it('booking twice, outside the window and after the start are refused', async () => {
    const s = await mk('2027-05-13', '11:00');
    await book('n', s).expect(201);
    const again = await book('n', s).expect(409);
    expect(again.body.message).toBe('Already booked');
    // The window opens 14 days before: 2027-05-27 10:00 is 15 days away.
    const far = await mk('2027-05-27', '10:00');
    await book('n', far).expect(400);
    // 10:00 today has already started (it is 12:00).
    const started = await mk('2027-05-12', '10:00');
    await book('n', started).expect(400);
    // Exactly 14 days before the start is allowed.
    const edge = await mk('2027-05-26', '12:00');
    await book('n', edge).expect(201);
  });

  it('a member without classes is refused', async () => {
    const s = await mk('2027-05-13', '12:00');
    const r = await book('stranger', s).expect(403);
    expect(r.status).toBe(403);
    await f.req('post', `/class-sessions/${s}/bookings`, 'u').expect(403);
    await newMember('r');
    const none = await book('r', s).expect(409);
    expect(none.body.message).toBe('No membership for classes');
  });

  it('the owner cancels a session with 3 bookings: all cancelled, no entry consumed', async () => {
    await sell('q', packType.id);
    const s = await mk('2027-05-14', '18:00');
    await book('n', s).expect(201);
    await book('p', s).expect(201);
    await book('q', s).expect(201);
    await f.req('post', `/class-sessions/${s}/cancel`, 'owner').send({ reason: 'x' }).expect(204);
    expect((await bookings(s)).map((b) => [b.status, b.entryConsumed])).toEqual([
      ['cancelled', false],
      ['cancelled', false],
      ['cancelled', false],
    ]);
    expect(await used('q')).toEqual([0]);
    await book('n', s).expect(410);
  });

  it('ending a series cancels the booked future session and removes the empty ones', async () => {
    const made = await f
      .req('post', '/class-series', 'owner')
      .send({
        classTypeId: spinning.id,
        weekday: 6,
        startsAt: '18:00',
        durationMinutes: 45,
        capacity: 5,
        validFrom: '2027-05-15',
      })
      .expect(201);
    const rows = await systemDb
      .select()
      .from(classSessions)
      .where(eq(classSessions.seriesId, made.body.id));
    const second = rows.find((r) => r.date === '2027-05-22')!;
    await book('p', second.id).expect(201);
    await f
      .req('post', `/class-series/${made.body.id}/end`, 'owner')
      .send({ lastDate: '2027-05-15' })
      .expect(204);
    const after = await systemDb
      .select()
      .from(classSessions)
      .where(eq(classSessions.seriesId, made.body.id));
    expect(after.map((r) => r.date).sort()).toEqual(['2027-05-15', '2027-05-22']);
    expect(after.find((r) => r.date === '2027-05-22')!.cancelledAt).not.toBeNull();
    expect((await bookings(second.id))[0]!.status).toBe('cancelled');
  });

  it('reception books for a member and cancels for them without charge; staff reads are gated', async () => {
    const s = await mk('2027-05-14', '09:00', { trainerId: f.id.t });
    const r = await book('rec', s, { memberId: f.id.n }).expect(201);
    expect(r.body.id).toEqual(expect.any(String));
    const [b] = await bookings(s);
    expect(b).toMatchObject({ memberId: f.id.n, bookedBy: f.id.rec });
    await book('n', s, { memberId: f.id.p }).expect(403);

    await f.req('get', `/class-sessions/${s}/attendees`, 'u').expect(403);
    await f.req('get', `/class-sessions/${s}/attendees`, 'n').expect(403);
    const mine = (await f.req('get', `/class-sessions/${s}/attendees`, 't').expect(200)).body as Attendee[];
    expect(mine).toMatchObject([{ bookingId: b!.id, status: 'booked', member: { id: f.id.n } }]);
    await f.req('get', `/class-sessions/${s}/attendees`, 'rec').expect(200);

    await f.req('delete', `/bookings/${b!.id}`, 'n').expect(403);
    await f.req('delete', `/bookings/${b!.id}`, 'rec').expect(204);
    expect((await bookings(s))[0]!.status).toBe('cancelled');
    const history = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.gymId, f.gymId), eq(auditLog.action, 'booking.cancelled_by_staff')));
    expect(history).toHaveLength(1);
    await f.req('delete', `/bookings/${b!.id}`, 'rec').expect(409);
  });

  it('a member lists their own bookings and cannot cancel somebody else’s', async () => {
    const s = await mk('2027-05-14', '14:00');
    await book('n', s).expect(201);
    const list = (await f.req('get', '/me/bookings?upcoming=true', 'n').expect(200)).body as BookingView[];
    expect(list.map((x) => x.session.id)).toContain(s);
    expect(list.every((x) => x.status === 'booked')).toBe(true);
    expect(list.every((x) => x.late === false && x.usesEntry === false)).toBe(true);
    const theirs = (await bookings(s))[0]!;
    await f.req('delete', `/me/bookings/${theirs.id}`, 'p').expect(404);
    // The refused cancel changed nothing.
    expect((await bookings(s))[0]).toMatchObject({ status: 'booked', entryConsumed: false });
    const seen = (await f.req('get', `/class-sessions?from=2027-05-14&to=2027-05-14`, 'n').expect(200))
      .body as ClassSessionView[];
    expect(seen.find((x) => x.id === s)!.myBooking).toMatchObject({
      id: theirs.id,
      status: 'booked',
      usesEntry: false,
      late: false,
    });
    // Other sessions that day (09:00 cancelled by staff, 18:00 cancelled session) are not shown as booked.
    const others = seen.filter((x) => x.id !== s);
    expect(others.length).toBeGreaterThanOrEqual(2);
    expect(others.every((x) => x.myBooking?.status !== 'booked')).toBe(true);
  });

  it('the cancel cut-off is 120 min: exactly at it is late, a minute earlier is free', async () => {
    await newMember('x');
    await newMember('y');
    await sell('x', packType.id);
    await sell('y', packType.id);
    const sx = await mk('2027-05-12', '21:00'); // cut-off moment 19:00 local
    const sy = await mk('2027-05-12', '22:00'); // cut-off moment 20:00 local
    await book('x', sx).expect(201);
    await book('y', sy).expect(201);
    f.clock.current = local('2027-05-12', '19:00');
    expect((await f.req('delete', `/me/bookings/${(await bookings(sx))[0]!.id}`, 'x').expect(200)).body).toEqual({
      status: 'late_cancelled',
    });
    expect(await used('x')).toEqual([1]);
    f.clock.current = local('2027-05-12', '19:59'); // 121 min before 22:00
    expect((await f.req('delete', `/me/bookings/${(await bookings(sy))[0]!.id}`, 'y').expect(200)).body).toEqual({
      status: 'cancelled',
    });
    expect(await used('y')).toEqual([0]);
    f.clock.setDay(DAY);
  });

  it('staff cancelling inside the late window never consumes the member’s class-pack entry', async () => {
    await newMember('z');
    await sell('z', packType.id);
    const s = await mk('2027-05-12', '14:00');
    await book('z', s).expect(201);
    f.clock.current = local('2027-05-12', '13:30'); // 30 min before: a member's own cancel would be late
    await f.req('delete', `/bookings/${(await bookings(s))[0]!.id}`, 'rec').expect(204);
    f.clock.setDay(DAY);
    expect((await bookings(s))[0]).toMatchObject({ status: 'cancelled', entryConsumed: false });
    expect(await used('z')).toEqual([0]);
    // The reservation was released: the pack can pay for another class.
    await book('z', await mk('2027-05-13', '15:00')).expect(201);
  });

  it('the session list tells a pack member their booking is paid by an entry and when it turns late', async () => {
    await newMember('lp');
    await sell('lp', packType.id);
    f.clock.setDay(DAY); // 12:00 local
    const s = await mk('2027-05-12', '13:30'); // 90 min away: inside the 120-min cut-off
    const far = await mk('2027-05-12', '20:00');
    await book('lp', far).expect(201);
    const list = (await f.req('get', '/class-sessions?from=2027-05-12&to=2027-05-12', 'lp').expect(200))
      .body as ClassSessionView[];
    expect(list.find((x) => x.id === far)!.myBooking).toMatchObject({ usesEntry: true, late: false });
    expect(list.find((x) => x.id === s)!.myBooking).toBeUndefined();
    f.clock.current = local('2027-05-12', '19:00'); // 60 min before the 20:00 class
    const later = (await f.req('get', '/class-sessions?from=2027-05-12&to=2027-05-12', 'lp').expect(200))
      .body as ClassSessionView[];
    expect(later.find((x) => x.id === far)!.myBooking).toMatchObject({ usesEntry: true, late: true });
    f.clock.setDay(DAY);
  });

  it('a pack’s remaining visits subtract its booked classes', async () => {
    await newMember('w');
    await sell('w', packType.id);
    const s = await mk('2027-05-15', '10:00');
    await book('w', s).expect(201);
    const ms = (await f.req('get', '/me/memberships', 'w').expect(200)).body as {
      memberships: { remaining: { visits: number } }[];
    };
    expect(ms.memberships[0]!.remaining.visits).toBe(0);
  });
});
