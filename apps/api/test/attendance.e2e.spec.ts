import type { CheckInResult, MembershipType } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens';
import { AttendanceService } from '../src/classes/attendance.service';
import { systemDb } from '../src/db/client';
import {
  classBookings,
  classSeries,
  classSessions,
  classTypes,
  gymRoles,
  memberships,
  users,
} from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** Athens is UTC+3 on and after 2027-03-28 (summer time), UTC+2 before. */
const local = (day: string, hhmm: string, offsetHours = 3): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - offsetHours) * 60 + m) * 60_000);
};

describe('class attendance, no-shows and door access for booked classes', () => {
  let f: HealthFixture;
  let typeId: string;
  let packType: MembershipType;
  let attendance: AttendanceService;

  async function newMember(name: string): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${name}-${f.run}@x.gr`, firstName: name, lastName: 'Member' })
      .returning({ id: users.id });
    f.id[name] = u!.id;
    f.tok[name] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
  }
  const sell = (member: string, startsOn = DAY) =>
    f
      .req('post', `/members/${f.id[member]}/memberships`, 'rec')
      .send({ typeId: packType.id, amountCents: 1000, method: 'cash', startsOn })
      .expect(201);
  async function mk(date: string, startsAt: string, over: Record<string, unknown> = {}) {
    const r = await f
      .req('post', '/class-sessions', 'owner')
      .send({ classTypeId: typeId, date, startsAt, durationMinutes: 45, capacity: 10, ...over })
      .expect(201);
    return (r.body as { id: string }).id;
  }
  const book = (who: string, sessionId: string) =>
    f.req('post', `/class-sessions/${sessionId}/bookings`, who).send({});
  const booking = async (sessionId: string, member: string) =>
    (await systemDb.select().from(classBookings).where(eq(classBookings.sessionId, sessionId))).find(
      (b) => b.memberId === f.id[member],
    )!;
  const used = async (member: string) =>
    (
      await systemDb
        .select({ u: memberships.visitsUsed })
        .from(memberships)
        .where(eq(memberships.memberId, f.id[member]!))
    )
      .map((r) => r.u)
      .sort();
  const checkIn = async (member: string) =>
    (await f.req('post', `/members/${f.id[member]}/check-ins`, 'rec').expect(201))
      .body as CheckInResult;
  const mark = (who: string, bookingId: string, status: string) =>
    f.req('post', `/bookings/${bookingId}/attendance`, who).send({ status });

  beforeAll(async () => {
    f = await setupHealthFixture('Attendance');
    attendance = f.app.get(AttendanceService);
    typeId = (
      await f
        .req('post', '/class-types', 'owner')
        .send({ name: 'Spinning', defaultCapacity: 10, defaultDurationMinutes: 45 })
        .expect(201)
    ).body.id;
    packType = (
      await f
        .req('post', '/membership-types', 'owner')
        .send({ name: 'Πακέτο', kind: 'classes', visitCount: 5, priceCents: 1000, includesClasses: true })
        .expect(201)
    ).body as MembershipType;
    for (const n of ['w', 'x', 'y', 'z']) await newMember(n);
  });

  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(classBookings).where(eq(classBookings.gymId, g));
      await systemDb.delete(classSessions).where(eq(classSessions.gymId, g));
      await systemDb.delete(classSeries).where(eq(classSeries.gymId, g));
      await systemDb.delete(classTypes).where(eq(classTypes.gymId, g));
    });
  });

  it('a class-pack-only member checks in 30 min before their class: valid, booking attended, one entry used', async () => {
    await sell('w');
    const s = await mk(DAY, '18:00', { trainerId: f.id.t });
    await book('w', s).expect(201);

    // 2 hours before: the door stays shut for a class pack, the booking is untouched.
    f.clock.current = local(DAY, '16:00');
    const early = await checkIn('w');
    expect(early).toMatchObject({ valid: false, reason: 'classes_only' });
    expect(early.classBooking).toBeUndefined();
    expect((await booking(s, 'w')).status).toBe('booked');

    f.clock.current = local(DAY, '17:30');
    const ok = await checkIn('w');
    expect(ok).toMatchObject({ valid: true, reason: null });
    expect(ok.classBooking).toMatchObject({ sessionId: s, typeName: 'Spinning', startsAt: '18:00' });
    expect(await booking(s, 'w')).toMatchObject({ status: 'attended', entryConsumed: true });
    expect(await used('w')).toEqual([1]);

    // The trainer then ticks the same booking attended: nothing is consumed twice.
    f.clock.current = local(DAY, '18:10');
    await mark('t', (await booking(s, 'w')).id, 'attended').expect(204);
    await mark('rec', (await booking(s, 'w')).id, 'attended').expect(204);
    expect(await used('w')).toEqual([1]);
  });

  it('without a booking in the window, a class-pack-only member is still classes_only', async () => {
    await sell('x');
    f.clock.current = local(DAY, '17:30');
    expect(await checkIn('x')).toMatchObject({ valid: false, reason: 'classes_only' });
    // A booking for another day does not open the door either.
    const later = await mk('2027-05-13', '18:00');
    await book('x', later).expect(201);
    f.clock.current = local(DAY, '17:45');
    expect(await checkIn('x')).toMatchObject({ valid: false, reason: 'classes_only' });
    expect(await used('x')).toEqual([0]);
  });

  it('a time membership holder arriving for a booked class is let in and marked attended', async () => {
    f.clock.setDay(DAY);
    const s = await mk(DAY, '20:00');
    await book('m', s).expect(409); // m's membership has no classes: not eligible
    f.clock.current = local(DAY, '19:30');
    const r = await checkIn('m');
    expect(r.valid).toBe(true);
    expect(r.classBooking).toBeUndefined();
  });

  it('reception marks a no-show; a member and a trainer who does not run the class cannot', async () => {
    f.clock.setDay(DAY);
    await sell('y');
    const s = await mk(DAY, '21:00', { trainerId: f.id.t });
    await book('y', s).expect(201);
    const id = (await booking(s, 'y')).id;
    f.clock.current = local(DAY, '20:30');
    await mark('y', id, 'no_show').expect(403);
    await mark('u', id, 'no_show').expect(403);
    await mark('rec', id, 'no_show').expect(204);
    expect(await booking(s, 'y')).toMatchObject({ status: 'no_show', entryConsumed: true });
    expect(await used('y')).toEqual([1]);
    await mark('rec', id, 'no_show').expect(204);
    expect(await used('y')).toEqual([1]);
    await mark('rec', id, 'bogus').expect(400);
  });

  it('a class that has not started cannot be marked', async () => {
    f.clock.setDay(DAY);
    await sell('z');
    const s = await mk('2027-05-13', '18:00', { trainerId: f.id.t });
    await book('z', s).expect(201);
    await mark('t', (await booking(s, 'z')).id, 'attended').expect(400);
    expect(await used('z')).toEqual([0]);
  });

  it('the no-show pass runs 30 min after the end, marks the rest once, and spares the attended', async () => {
    f.clock.setDay(DAY);
    for (const n of ['w', 'x']) await sell(n); // second packs, so there is room
    const s = await mk('2027-05-14', '09:00'); // ends 09:45 local
    f.clock.current = local('2027-05-13', '12:00');
    await book('w', s).expect(201);
    await book('x', s).expect(201);
    f.clock.current = local('2027-05-14', '09:10');
    await mark('rec', (await booking(s, 'w')).id, 'attended').expect(204);

    // Classes of earlier tests are long over; settle them so only this session is in play.
    await attendance.noShowPass(f.gymId, local('2027-05-14', '08:00'));
    const before = await used('x');
    // 10:14 local: not yet 30 minutes after the end.
    expect(await attendance.noShowPass(f.gymId, local('2027-05-14', '10:14'))).toEqual({ marked: 0 });
    expect((await booking(s, 'x')).status).toBe('booked');
    expect(await attendance.noShowPass(f.gymId, local('2027-05-14', '10:15'))).toEqual({ marked: 1 });
    expect(await booking(s, 'x')).toMatchObject({ status: 'no_show', entryConsumed: true });
    expect((await booking(s, 'w')).status).toBe('attended');
    // Twice: consumed once.
    expect(await attendance.noShowPass(f.gymId, local('2027-05-14', '11:00'))).toEqual({ marked: 0 });
    const after = await used('x');
    expect(after.reduce((a, b) => a + b, 0)).toBe(before.reduce((a, b) => a + b, 0) + 1);
  });

  it('on the DST day a 09:00 class of 45 min gets its no-show pass at 10:15 local, not at 09:45', async () => {
    // 2027-03-28: Athens switches to UTC+3 at 03:00, so 09:00 local is 06:00Z and 10:15 is 07:15Z.
    f.clock.current = new Date('2027-03-20T10:00:00Z');
    await newMember('dst');
    await sell('dst', '2027-03-20');
    const s = await mk('2027-03-28', '09:00');
    await book('dst', s).expect(201);
    const [row] = await systemDb.select().from(classSessions).where(eq(classSessions.id, s));
    expect(row!.startsAtUtc.toISOString()).toBe('2027-03-28T06:00:00.000Z');
    expect(await attendance.noShowPass(f.gymId, new Date('2027-03-28T06:45:00Z'))).toEqual({ marked: 0 });
    expect(await attendance.noShowPass(f.gymId, new Date('2027-03-28T07:14:00Z'))).toEqual({ marked: 0 });
    expect((await booking(s, 'dst')).status).toBe('booked');
    expect(await attendance.noShowPass(f.gymId, new Date('2027-03-28T07:15:00Z'))).toEqual({ marked: 1 });
    expect((await booking(s, 'dst')).status).toBe('no_show');
  });
});
