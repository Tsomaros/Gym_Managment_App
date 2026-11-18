import type { MembershipType } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassNotifier } from '../src/classes/class-notifier';
import { systemDb } from '../src/db/client';
import {
  classBookings,
  classSeries,
  classSessions,
  classTypes,
  gymRoles,
  notificationPrefs,
  notificationsSent,
  users,
} from '../src/db/schema';
import { NotificationService } from '../src/notifications/notification.service';
import { signAccessToken } from '../src/auth/tokens';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** Athens is UTC+3 in May 2027. */
const local = (day: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60_000);
};

describe('class reminders and cancellation notices', () => {
  let f: HealthFixture;
  let typeId: string;
  let timeType: MembershipType;
  let notifier: ClassNotifier;
  const emailOf = (who: string) => `${who}-${f.run}@x.gr`;
  const mailTo = (who: string) => f.mail.sent.filter((m) => m.to === emailOf(who));
  const settle = () => f.app.get(NotificationService).idle();
  const sentRows = () =>
    systemDb.select().from(notificationsSent).where(eq(notificationsSent.gymId, f.gymId));

  async function newMember(name: string): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: emailOf(name), firstName: name, lastName: 'Member' })
      .returning({ id: users.id });
    f.id[name] = u!.id;
    f.tok[name] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId: u!.id, role: 'member' });
    await f
      .req('post', `/members/${u!.id}/memberships`, 'rec')
      .send({ typeId: timeType.id, amountCents: 1000, method: 'cash', startsOn: DAY })
      .expect(201);
  }
  async function mk(date: string, startsAt: string) {
    const r = await f
      .req('post', '/class-sessions', 'owner')
      .send({ classTypeId: typeId, date, startsAt, durationMinutes: 45, capacity: 10 })
      .expect(201);
    return (r.body as { id: string }).id;
  }
  const book = (who: string, sessionId: string) =>
    f.req('post', `/class-sessions/${sessionId}/bookings`, who).send({}).expect(201);

  beforeAll(async () => {
    f = await setupHealthFixture('ClassNotes');
    f.clock.current = local(DAY, '12:00');
    notifier = f.app.get(ClassNotifier);
    typeId = (
      await f
        .req('post', '/class-types', 'owner')
        .send({ name: 'Σπινινγκ', nameEn: 'Spinning', defaultCapacity: 10, defaultDurationMinutes: 45 })
        .expect(201)
    ).body.id;
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
    for (const n of ['a', 'b', 'c']) await newMember(n);
  });

  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(notificationsSent).where(eq(notificationsSent.gymId, g));
      await systemDb.delete(notificationPrefs).where(eq(notificationPrefs.gymId, g));
      await systemDb.delete(classBookings).where(eq(classBookings.gymId, g));
      await systemDb.delete(classSessions).where(eq(classSessions.gymId, g));
      await systemDb.delete(classSeries).where(eq(classSeries.gymId, g));
      await systemDb.delete(classTypes).where(eq(classTypes.gymId, g));
    });
  });

  it('a reminder goes out when the class is within 2 hours, once', async () => {
    const s = await mk(DAY, '18:00');
    await book('a', s);
    await notifier.remindersPass(local(DAY, '15:50')); // 2 h 10 min before
    await settle();
    expect(mailTo('a')).toHaveLength(0);
    await notifier.remindersPass(local(DAY, '16:05')); // 1 h 55 min before
    await settle();
    expect(mailTo('a')).toHaveLength(1);
    expect(mailTo('a')[0]!.text).toContain('Σπινινγκ');
    expect(mailTo('a')[0]!.text).toContain('18:00');
    await notifier.remindersPass(local(DAY, '16:20'));
    await settle();
    expect(mailTo('a')).toHaveLength(1);
  });

  it('a member with the classes group switched off gets no reminder and no dedupe row', async () => {
    const s = await mk('2027-05-13', '10:00');
    await book('c', s);
    await f
      .req('put', '/me/notification-prefs', 'c')
      .send({
        membership: { email: true, push: true },
        plans: { email: true, push: true },
        classes: { email: false, push: false },
      })
      .expect(200);
    const before = (await sentRows()).length;
    await notifier.remindersPass(local('2027-05-13', '08:30'));
    await settle();
    expect(mailTo('c')).toHaveLength(0);
    expect(await sentRows()).toHaveLength(before);
  });

  it('cancelling a session with 2 bookings notifies each member once; retrying notifies nobody', async () => {
    f.clock.current = local(DAY, '12:00');
    const s = await mk('2027-05-14', '18:00');
    await book('a', s);
    await book('b', s);
    const beforeA = mailTo('a').length;
    const beforeB = mailTo('b').length;
    await f.req('post', `/class-sessions/${s}/cancel`, 'owner').send({ reason: 'Ασθένεια' }).expect(204);
    await settle();
    expect(mailTo('a')).toHaveLength(beforeA + 1);
    expect(mailTo('b')).toHaveLength(beforeB + 1);
    expect(mailTo('a').at(-1)!.text).toContain('Ασθένεια');
    await f.req('post', `/class-sessions/${s}/cancel`, 'owner').send({ reason: 'Ασθένεια' }).expect(204);
    await settle();
    expect(mailTo('a')).toHaveLength(beforeA + 1);
    expect(mailTo('b')).toHaveLength(beforeB + 1);
    const keys = (await sentRows()).map((r) => r.dedupeKey);
    expect(keys.filter((k) => k.startsWith(`class_cancelled:${s}:`))).toHaveLength(2);
  });

  it('ending a series notifies the members of the sessions it had to cancel', async () => {
    const made = await f
      .req('post', '/class-series', 'owner')
      .send({
        classTypeId: typeId,
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
    await book('a', second.id);
    const before = mailTo('a').length;
    await f
      .req('post', `/class-series/${made.body.id}/end`, 'owner')
      .send({ lastDate: '2027-05-15' })
      .expect(204);
    await settle();
    expect(mailTo('a')).toHaveLength(before + 1);
  });
});
