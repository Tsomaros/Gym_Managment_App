import type { Dashboard, Payment } from '@gym/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import { gymRoles, users } from '../src/db/schema';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('owner dashboard (gym in Europe/Athens)', () => {
  let f: HealthFixture;
  let typeId: string;
  const get = async (who = 'owner') =>
    (await f.req('get', '/dashboard', who).expect(200)).body as Dashboard;
  const row = (d: Dashboard, month: string) => d.income.find((i) => i.month === month)!;

  beforeAll(async () => {
    f = await setupHealthFixture('Dash');
    typeId = (
      (await f.req('get', '/membership-types', 'owner').expect(200)).body as { id: string }[]
    )[0]!.id;
  });
  afterAll(async () => {
    await f.cleanup();
  });

  it('gives the owner 12 months of income, ending with the current one, and the fixture sales', async () => {
    const d = await get();
    expect(d.income).toHaveLength(12);
    expect(d.income[0]!.month).toBe('2026-06');
    expect(d.income[11]!.month).toBe('2027-05');
    // The fixture sold two 40-euro memberships in cash on 12 May.
    expect(row(d, '2027-05')).toMatchObject({
      totalCents: 8000,
      byMethod: { cash: 8000, card: 0 },
      byType: [{ name: 'Με γυμναστή', cents: 8000 }],
    });
    expect(d.income.slice(0, 11).every((i) => i.totalCents === 0)).toBe(true);
    expect(d.busyHours).toHaveLength(7);
    expect(d.members).toHaveLength(12);
  });

  it('counts a 23:30 Athens sale of 31 March in March and a card payment in the card column', async () => {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `x-${f.run}@x.gr`, firstName: 'Late', lastName: 'Buyer' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
    f.clock.current = new Date('2027-03-31T20:30:00Z'); // 23:30 in Athens
    await f
      .req('post', `/members/${u!.id}/memberships`, 'rec')
      .send({ typeId, amountCents: 2500, method: 'card' })
      .expect(201);
    f.clock.setDay('2027-05-12');
    const d = await get();
    expect(row(d, '2027-03')).toMatchObject({
      totalCents: 2500,
      byMethod: { cash: 0, card: 2500 },
    });
    expect(row(d, '2027-04').totalCents).toBe(0);
    expect(row(d, '2027-05').totalCents).toBe(8000);
  });

  it('counts new and active members, and is a snapshot of today for the current month', async () => {
    const d = await get();
    const may = d.members.find((x) => x.month === '2027-05')!;
    // m and n started on 12 May (new in May); both run until 11 June.
    expect(may.new).toBe(2);
    expect(may.active).toBe(2);
    expect(may.provisional).toBe(true);
    const march = d.members.find((x) => x.month === '2027-03')!;
    expect(march.new).toBe(1); // the late buyer of 31 March
  });

  it('today: visitors, who is in now, and memberships ending within 7 days', async () => {
    let d = await get();
    expect(d.today).toEqual({ visitors: 0, present: 0, expiringSoon: 0 });

    await f.req('post', `/members/${f.id.m}/check-ins`, 'rec').expect(201);
    f.clock.advance(5 * 60_000);
    await f.req('post', `/members/${f.id.m}/check-ins`, 'rec').expect(201); // again: still one visitor
    await f.req('post', `/members/${f.id.n}/check-ins`, 'rec').expect(201);
    d = await get();
    expect(d.today.visitors).toBe(2);
    expect(d.today.present).toBe(2);
    // m twice (the second is 5 minutes later, outside the 2-minute duplicate window) and n once:
    // three valid check-ins, all on Wednesday (row 2) between 12:00 and 12:05 Athens (09:00Z + 3h).
    expect(d.busyHours.flat().reduce((a, b) => a + b, 0)).toBe(3);
    expect(d.busyHours[2]![12]).toBe(3);

    f.clock.setDay('2027-05-20'); // 22 days before the memberships end: not expiring yet
    d = await get();
    expect(d.today.expiringSoon).toBe(0);
    // Memberships end 11 June. "Within 7 days, today included": 5 June is the last day 7 remain.
    f.clock.setDay('2027-06-04');
    expect((await get()).today.expiringSoon).toBe(0);
    f.clock.setDay('2027-06-05');
    expect((await get()).today.expiringSoon).toBe(2);
    f.clock.setDay('2027-06-06'); // 5 days before the end of the fixture memberships
    d = await get();
    expect(d.today.expiringSoon).toBe(2);
    expect(d.today.visitors).toBe(0);
    f.clock.setDay('2027-05-12');
  });

  it('shows the owner busy hours of the last 8 weeks only', async () => {
    // The check-ins were at 12:00-12:05 Athens on 12 May: 56 days later at 09:00Z is the exact edge.
    f.clock.setDay('2027-07-07');
    expect((await get()).busyHours[2]![12]).toBe(3);
    f.clock.setDay('2027-07-08'); // the May check-ins are now more than 8 weeks old
    const d = await get();
    expect(d.busyHours.flat().reduce((a, b) => a + b, 0)).toBe(0);
    f.clock.setDay('2027-05-12');
  });

  it('a voided payment disappears from the income, and its voided membership from the member counts', async () => {
    const list = (
      await f.req('get', '/payments?from=2027-05-01&to=2027-05-31', 'owner').expect(200)
    ).body as Payment[];
    const may = list.find((p) => p.memberId === f.id.m && p.paidAt.startsWith('2027-05'))!;
    await f
      .req('post', `/payments/${may.id}/void`, 'owner')
      .send({ reason: 'Λάθος ποσό' })
      .expect(204);
    const d = await get();
    expect(row(d, '2027-05').totalCents).toBe(4000);
    // Voiding a payment voids its membership: that member is neither new nor active any more.
    const may2 = d.members.find((x) => x.month === '2027-05')!;
    expect(may2).toMatchObject({ new: 1, active: 1 });
  });

  it('refuses everyone but the owner: reception, trainer, member and another gym', async () => {
    for (const who of ['rec', 't', 'm']) await f.req('get', '/dashboard', who).expect(403);
    await f.req('get', '/dashboard', 'owner', f.otherGymId).expect(403);
    await f.req('get', '/dashboard', 'stranger', f.otherGymId).expect(403);
  });

  it('two gyms never mix: the owner of the other gym sees none of the first gym money or members', async () => {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `o2-${f.run}@x.gr`, firstName: 'Other', lastName: 'Owner' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: f.otherGymId, userId: u!.id, role: 'owner' });
    const token = signAccessToken({ sub: u!.id, adm: false });
    const dash = async () =>
      (
        await request(f.app.getHttpServer())
          .get(`/gyms/${f.otherGymId}/dashboard`)
          .auth(token, { type: 'bearer' })
          .expect(200)
      ).body as Dashboard;
    const other = await dash();
    expect(other.income.reduce((sum, i) => sum + i.totalCents, 0)).toBe(0);
    expect(other.members.every((x) => x.new === 0 && x.notRenewed === 0)).toBe(true);
    expect(other.today).toEqual({ visitors: 0, present: 0, expiringSoon: 0 });

    // Now the other gym earns money of its own: the first gym must not see it either.
    f.tok.o2 = token;
    const t2 = (
      await f
        .req('post', '/membership-types', 'o2', f.otherGymId)
        .send({
          name: 'Other gym plan',
          kind: 'time',
          durationMonths: 1,
          priceCents: 9000,
          maxFreezeDays: 0,
          includesTrainer: false,
        })
        .expect(201)
    ).body as { id: string };
    await f
      .req('post', `/members/${f.id.stranger}/memberships`, 'o2', f.otherGymId)
      .send({ typeId: t2.id, amountCents: 9000, method: 'card' })
      .expect(201);
    const other2 = await dash();
    expect(row(other2, '2027-05')).toMatchObject({
      totalCents: 9000,
      byMethod: { cash: 0, card: 9000 },
      byType: [{ name: 'Other gym plan', cents: 9000 }],
    });
    expect(other2.members.find((x) => x.month === '2027-05')).toMatchObject({ new: 1, active: 1 });
    const first = await get();
    // First gym May: one 40-euro sale left after the void in the previous test; no 9000 anywhere.
    expect(first.income.reduce((sum, i) => sum + i.totalCents, 0)).toBe(4000 + 2500);
    expect(row(first, '2027-05').byType).toEqual([{ name: 'Με γυμναστή', cents: 4000 }]);
    expect(first.members.find((x) => x.month === '2027-05')).toMatchObject({ new: 1, active: 1 });
  });
});
