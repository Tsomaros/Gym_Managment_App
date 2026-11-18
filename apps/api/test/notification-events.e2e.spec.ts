import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { gymRoles, notificationPrefs, notificationsSent, users } from '../src/db/schema';
import { NotificationService } from '../src/notifications/notification.service';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('event notifications: visit pack running low, new plan', () => {
  let f: HealthFixture;
  let packMember: string;
  let packType: string;
  let exerciseId: string;
  const emailOf = (who: string) => `${who.toLowerCase()}-${f.run}@x.gr`;
  const mailTo = (to: string) => f.mail.sent.filter((m) => m.to === to);
  const settle = () => f.app.get(NotificationService).idle();

  /** Reception checks the member in; the clock moves past the 2-minute duplicate window first. */
  async function checkIn(memberId: string) {
    f.clock.advance(5 * 60_000);
    const res = await f.req('post', `/members/${memberId}/check-ins`, 'rec').expect(201);
    await settle();
    return res.body as { valid: boolean; duplicate: boolean };
  }

  beforeAll(async () => {
    f = await setupHealthFixture('Events');
    const [u] = await systemDb
      .insert(users)
      .values({ email: emailOf('pk'), firstName: 'Pack', lastName: 'Test' })
      .returning({ id: users.id });
    packMember = u!.id;
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: packMember, role: 'member' });
    packType = (
      await f
        .req('post', '/membership-types', 'owner')
        .send({ name: 'Πακέτο 10', kind: 'visits', visitCount: 10, priceCents: 5000 })
        .expect(201)
    ).body.id as string;
    exerciseId = f.exIds[0]!;
  });
  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(notificationsSent).where(eq(notificationsSent.gymId, g));
    });
  });
  beforeEach(() => {
    f.mail.sent = [];
  });

  it('sends "running low" at 2, 1 and 0 visits left, once each, and not for a repeated scan', async () => {
    await f
      .req('post', `/members/${packMember}/memberships`, 'rec')
      .send({ typeId: packType, amountCents: 5000, method: 'cash' })
      .expect(201);
    for (let i = 0; i < 7; i++) await checkIn(packMember); // 3 left
    expect(mailTo(emailOf('pk'))).toEqual([]);

    await checkIn(packMember); // 2 left
    expect(mailTo(emailOf('pk'))).toHaveLength(1);
    expect(mailTo(emailOf('pk'))[0]!.text).toContain('απομένουν 2 επισκέψεις');

    // The same scan again within two minutes repeats the first check-in and spends nothing.
    f.clock.advance(30_000);
    const repeat = await f.req('post', `/members/${packMember}/check-ins`, 'rec').expect(201);
    await settle();
    expect((repeat.body as { duplicate: boolean }).duplicate).toBe(true);
    expect(mailTo(emailOf('pk'))).toHaveLength(1);

    await checkIn(packMember); // 1 left
    expect(mailTo(emailOf('pk'))).toHaveLength(2);
    expect(mailTo(emailOf('pk'))[1]!.text).toContain('απομένουν 1 επισκέψεις');
    await checkIn(packMember); // 0 left
    expect(mailTo(emailOf('pk'))).toHaveLength(3);
    expect(mailTo(emailOf('pk'))[2]!.subject).toMatch(/επισκέψεις/);
    expect(mailTo(emailOf('pk'))[2]!.text).toContain('Χρησιμοποίησες όλες τις επισκέψεις');

    const keys = (
      await systemDb
        .select({ k: notificationsSent.dedupeKey })
        .from(notificationsSent)
        .where(eq(notificationsSent.userId, packMember))
    ).map((r) => r.k.replace(/^visits_low:[0-9a-f-]{36}:/, ''));
    expect(keys.sort()).toEqual(['0', '1', '2']);

    // A refused check-in (pack used up) sends nothing.
    const refused = await checkIn(packMember);
    expect(refused.valid).toBe(false);
    expect(mailTo(emailOf('pk'))).toHaveLength(3);
  });

  it('a time-based membership never sends "running low"', async () => {
    for (let i = 0; i < 3; i++) expect((await checkIn(f.id.m!)).valid).toBe(true);
    expect(mailTo(emailOf('m'))).toEqual([]);
  });

  it('a check-in still succeeds when the email cannot be sent', async () => {
    const [u] = await systemDb
      .insert(users)
      .values({ email: emailOf('pk2'), firstName: 'Pack', lastName: 'Two' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
    await f
      .req('post', `/members/${u!.id}/memberships`, 'rec')
      .send({ typeId: packType, amountCents: 5000, method: 'cash' })
      .expect(201);
    for (let i = 0; i < 7; i++) await checkIn(u!.id);
    f.mail.failWith = new Error('smtp down');
    try {
      expect((await checkIn(u!.id)).valid).toBe(true); // 2 left: the low-visits email is attempted
    } finally {
      f.mail.failWith = null;
    }
    expect(mailTo(emailOf('pk2'))).toEqual([]); // the send really failed, nothing was delivered
  });

  const planBody = (over: Record<string, unknown> = {}) => ({
    title: 'Πάνω σώμα',
    days: [{ title: 'Ημέρα Α', exercises: [{ exerciseId, sets: 3, repsMin: 8, repsMax: 10 }] }],
    ...over,
  });

  it('activating a plan sends "new plan" once; editing it, or activating it again, sends nothing', async () => {
    const created = (
      await f.req('post', `/members/${f.id.m}/plans`, 't').send(planBody()).expect(201)
    ).body as { id: string };
    await settle();
    expect(mailTo(emailOf('m'))).toEqual([]); // a draft is not assigned yet

    await f.req('post', `/plans/${created.id}/activate`, 't').expect(200);
    await settle();
    expect(mailTo(emailOf('m'))).toHaveLength(1);
    expect(mailTo(emailOf('m'))[0]!.text).toContain('Πάνω σώμα');

    await f
      .req('put', `/plans/${created.id}`, 't')
      .send(planBody({ title: 'Νέος τίτλος' }))
      .expect(200);
    await f.req('post', `/plans/${created.id}/activate`, 't').expect(200);
    await settle();
    expect(mailTo(emailOf('m'))).toHaveLength(1);
  });

  it('creating a plan with activate sends one email; another active plan later sends another', async () => {
    await f
      .req('post', `/members/${f.id.n}/plans`, 't')
      .send(planBody({ activate: true, title: 'Πρώτο' }))
      .expect(201);
    await settle();
    expect(mailTo(emailOf('n'))).toHaveLength(1);
    await f
      .req('post', `/members/${f.id.n}/plans`, 't')
      .send(planBody({ activate: true, title: 'Δεύτερο' }))
      .expect(201);
    await settle();
    expect(mailTo(emailOf('n'))).toHaveLength(2);
    expect(mailTo(emailOf('n'))[1]!.text).toContain('Δεύτερο');
  });

  it('a member who switched the plans email off gets no plan email', async () => {
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: f.gymId, userId: f.id.m!, group: 'plans', email: false, push: false });
    try {
      await f
        .req('post', `/members/${f.id.m}/plans`, 't')
        .send(planBody({ activate: true, title: 'Σιωπηλό' }))
        .expect(201);
      await settle();
      expect(mailTo(emailOf('m'))).toEqual([]);
    } finally {
      await systemDb.delete(notificationPrefs).where(eq(notificationPrefs.userId, f.id.m!));
    }
  });
});
