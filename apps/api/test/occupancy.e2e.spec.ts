import type { Occupancy } from '@gym/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { checkIns, gymRoles, gyms, users } from '../src/db/schema';
import { levelFor } from '../src/checkin/occupancy';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('levelFor', () => {
  it('is quiet below 40 %, moderate from 40 % to below 75 %, busy from 75 %', () => {
    expect(levelFor(11, 30)).toBe('quiet'); // 36.7 %
    expect(levelFor(12, 30)).toBe('moderate'); // exactly 40 %
    expect(levelFor(22, 30)).toBe('moderate'); // 73.3 %
    expect(levelFor(23, 30)).toBe('busy'); // 76.7 %
    expect(levelFor(0, 30)).toBe('quiet');
    expect(levelFor(5, 10)).toBe('moderate'); // 50 %
    expect(levelFor(3, 4)).toBe('busy'); // exactly 75 %
    expect(levelFor(2, 4)).toBe('moderate');
    expect(levelFor(500, 30)).toBe('busy'); // over capacity is still just busy
  });
});

describe('occupancy (gym in Europe/Athens)', () => {
  let f: HealthFixture;
  const get = async (who: string, gym = f.gymId) =>
    (await f.req('get', '/occupancy', who, gym).expect(200)).body as Occupancy;
  const settings = (body: object) => f.req('patch', '/settings', 'owner').send(body);

  /** Gives `n` fresh members a valid check-in at the clock's time. */
  async function checkInMembers(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [u] = await systemDb
        .insert(users)
        .values({
          email: `occ${i}-${f.run}-${Date.now()}@x.gr`,
          firstName: `O${i}`,
          lastName: 'Test',
        })
        .returning({ id: users.id });
      await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
      await systemDb.insert(checkIns).values({
        gymId: f.gymId,
        memberId: u!.id,
        at: f.clock.now(),
        method: 'manual',
        valid: true,
      });
      ids.push(u!.id);
    }
    return ids;
  }

  beforeAll(async () => {
    f = await setupHealthFixture('Occ');
  });
  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, g));
    });
  });

  it('without a capacity a member sees nothing, and staff see the plain count', async () => {
    expect(await get('m')).toEqual({ level: null });
    await checkInMembers(2);
    expect(await get('m')).toEqual({ level: null });
    expect(await get('rec')).toEqual({ level: null, count: 2 });
  });

  it('rejects a capacity of 0 or 2001 and accepts 1 and 2000, from the owner only', async () => {
    for (const bad of [0, 2001, 1.5, '10', -3]) await settings({ capacity: bad }).expect(400);
    await settings({ showOccupancyCount: 'yes' }).expect(400);
    await settings({ capacity: 1 }).expect(200);
    await settings({ capacity: 2000 }).expect(200);
    await f.req('patch', '/settings', 'rec').send({ capacity: 10 }).expect(403);
    expect((await settings({ capacity: 10 }).expect(200)).body).toMatchObject({
      capacity: 10,
      showOccupancyCount: false,
    });
  });

  it('with the count switched off the member body has the level and no number anywhere', async () => {
    // 2 inside, capacity 10: 20 % is quiet.
    const body = (await f.req('get', '/occupancy', 'm').expect(200)).body as Occupancy;
    expect(body).toEqual({ level: 'quiet' });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/count|capacity/);
  });

  it('with the count switched on the member also gets the count and the capacity', async () => {
    await settings({ showOccupancyCount: true }).expect(200);
    expect(await get('m')).toEqual({ level: 'quiet', count: 2, capacity: 10 });
  });

  it('staff always get the count and capacity, whatever the member setting is', async () => {
    await settings({ showOccupancyCount: false }).expect(200);
    for (const who of ['rec', 't', 'owner']) {
      expect(await get(who)).toEqual({ level: 'quiet', count: 2, capacity: 10 });
    }
  });

  it('the level follows the number inside: moderate at 40 %, busy at 80 %', async () => {
    await checkInMembers(2); // 4 of 10
    expect((await get('m')).level).toBe('moderate');
    await checkInMembers(4); // 8 of 10
    expect((await get('m')).level).toBe('busy');
  });

  it('a refused check-in does not count', async () => {
    await systemDb.delete(checkIns).where(eq(checkIns.gymId, f.gymId));
    // A member with no running membership: reception's check-in is refused and recorded.
    const [u] = await systemDb
      .insert(users)
      .values({ email: `refused-${f.run}@x.gr`, firstName: 'No', lastName: 'Membership' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
    const res = await f.req('post', `/members/${u!.id}/check-ins`, 'rec').expect(201);
    expect((res.body as { valid: boolean }).valid).toBe(false);
    expect(await get('rec')).toEqual({ level: 'quiet', count: 0, capacity: 10 });
  });

  it('someone who checked out, or came in longer ago than the auto check-out time, is not inside', async () => {
    await systemDb.delete(checkIns).where(eq(checkIns.gymId, f.gymId));
    const [out, stale, fresh] = await checkInMembers(3);
    await systemDb
      .update(checkIns)
      .set({ checkedOutAt: f.clock.now() })
      .where(eq(checkIns.memberId, out!));
    // The gym's auto check-out is 120 minutes: 121 minutes ago is over, 119 is not.
    await systemDb
      .update(checkIns)
      .set({ at: new Date(f.clock.now().getTime() - 121 * 60_000) })
      .where(eq(checkIns.memberId, stale!));
    await systemDb
      .update(checkIns)
      .set({ at: new Date(f.clock.now().getTime() - 119 * 60_000) })
      .where(eq(checkIns.memberId, fresh!));
    expect(await get('rec')).toMatchObject({ count: 1 });
  });

  it('a member who came in twice counts once', async () => {
    await systemDb.delete(checkIns).where(eq(checkIns.gymId, f.gymId));
    const [twice] = await checkInMembers(1);
    await systemDb.insert(checkIns).values({
      gymId: f.gymId,
      memberId: twice!,
      at: new Date(f.clock.now().getTime() - 30 * 60_000),
      method: 'manual',
      valid: true,
    });
    expect(await get('rec')).toMatchObject({ count: 1 });
  });

  it('a check-in just before midnight in Athens is yesterday, one at midnight is today', async () => {
    await systemDb.delete(checkIns).where(eq(checkIns.gymId, f.gymId));
    const saved = f.clock.current;
    try {
      // 21:30 UTC on 12 May is 00:30 on 13 May in Athens (UTC+3 in summer). Everyone below is
      // inside the 120-minute auto check-out window, so only the gym-local day can exclude them.
      f.clock.current = new Date('2027-05-12T21:30:00Z');
      const [evening, lastSecond, midnight, twice] = await checkInMembers(4);
      const setAt = (id: string, iso: string) =>
        systemDb
          .update(checkIns)
          .set({ at: new Date(iso) })
          .where(eq(checkIns.memberId, id));
      await setAt(evening!, '2027-05-12T20:30:00Z'); // 23:30 Athens, 12 May (still 12 May in UTC too)
      await setAt(lastSecond!, '2027-05-12T20:59:59Z'); // 23:59:59 Athens, 12 May
      await setAt(midnight!, '2027-05-12T21:00:00Z'); // 00:00:00 Athens, 13 May
      await systemDb.insert(checkIns).values({
        gymId: f.gymId,
        memberId: twice!,
        at: new Date('2027-05-12T21:10:00Z'),
        method: 'manual',
        valid: true,
      });
      // Today's two: `midnight` and `twice`.
      expect(await get('rec')).toMatchObject({ count: 2 });
    } finally {
      f.clock.current = saved;
    }
  });

  it('a member of one gym cannot read another gym’s occupancy, and the other gym has its own', async () => {
    await f.req('get', '/occupancy', 'm', f.otherGymId).expect(403);
    const other = await get('stranger', f.otherGymId);
    expect(other).toEqual({ level: null });
    await systemDb.update(gyms).set({ capacity: 4 }).where(eq(gyms.id, f.otherGymId));
    expect(await get('stranger', f.otherGymId)).toEqual({ level: 'quiet' });
    // This gym's check-ins never reach the other gym.
    expect(await get('rec')).toMatchObject({ capacity: 10 });
  });

  it('is closed to people with no role and to signed-out callers', async () => {
    await f.req('get', '/occupancy', 'outsiderTrainer').expect(403);
    const res = await request(f.app.getHttpServer()).get(`/gyms/${f.gymId}/occupancy`);
    expect(res.status).toBe(401);
  });
});
