import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemDb } from '../src/db/client';
import {
  gymRoles,
  gyms,
  membershipFreezes,
  memberships,
  membershipTypes,
  notificationPrefs,
  notificationsSent,
  users,
} from '../src/db/schema';
import { NotificationService } from '../src/notifications/notification.service';
import { RemindersService } from '../src/notifications/reminders.service';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** 2027-06-06 is the day 5 days before the fixture memberships end (2027-06-11). Athens is UTC+3 in summer. */
const at = (iso: string, hhmmUtc: string) => new Date(`${iso}T${hhmmUtc}:00Z`);

describe('membership reminders (gym in Europe/Athens)', () => {
  let f: HealthFixture;
  let reminders: RemindersService;
  const emailsOf = (to: string) => f.mail.sent.filter((m) => m.to === to);
  const emailOf = (who: string) => `${who.toLowerCase()}-${f.run}@x.gr`;

  beforeAll(async () => {
    f = await setupHealthFixture('Remind');
    reminders = f.app.get(RemindersService);
    // The other gym's member is due on the same day as this gym's members (ends 11 June), so a
    // leak across gyms would show: without a due membership there, "stranger got nothing" is vacuous.
    const [otherType] = await systemDb
      .insert(membershipTypes)
      .values({
        gymId: f.otherGymId,
        name: 'Άλλο γυμναστήριο',
        kind: 'time',
        durationMonths: 1,
        priceCents: 4000,
      })
      .returning({ id: membershipTypes.id });
    await systemDb.insert(memberships).values({
      gymId: f.otherGymId,
      memberId: f.id.stranger!,
      typeId: otherType!.id,
      name: 'Άλλο γυμναστήριο',
      kind: 'time',
      priceCents: 4000,
      startsOn: '2027-05-12',
      baseEndsOn: '2027-06-11',
      endsOn: '2027-06-11',
    });
  });
  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(notificationsSent).where(eq(notificationsSent.gymId, g));
      await systemDb.delete(membershipFreezes).where(eq(membershipFreezes.gymId, g));
      await systemDb.delete(notificationPrefs).where(eq(notificationPrefs.gymId, g));
    });
  });
  beforeEach(async () => {
    f.mail.sent = [];
    f.mail.failWith = null;
    await systemDb.delete(notificationsSent).where(eq(notificationsSent.gymId, f.gymId));
    await systemDb.delete(notificationPrefs).where(eq(notificationPrefs.gymId, f.gymId));
  });

  it('does nothing before 10:00 gym time and sends one email per due member at 10:05', async () => {
    // 06:59 UTC is 09:59 in Athens: not yet.
    const early = await reminders.runForGym(f.gymId, at('2027-06-06', '06:59'));
    expect(early).toEqual({ sent: 0, duplicate: 0, optedOut: 0, failed: 0 });
    expect(f.mail.sent).toEqual([]);
    // 07:00 UTC is exactly 10:00 in Athens: the send hour itself is already allowed.
    const onTheHour = await reminders.runForGym(f.gymId, at('2027-06-06', '07:00'));
    expect(onTheHour).toMatchObject({ sent: 2, failed: 0 });
    f.mail.sent = [];
    await systemDb.delete(notificationsSent).where(eq(notificationsSent.gymId, f.gymId));
    // 07:05 UTC is 10:05 in Athens.
    const run = await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
    expect(run).toMatchObject({ sent: 2, failed: 0 });
    expect(emailsOf(emailOf('m'))).toHaveLength(1);
    expect(emailsOf(emailOf('n'))).toHaveLength(1);
    expect(emailsOf(emailOf('m'))[0]!.subject).toMatch(/λήγει σύντομα/);
    expect(emailsOf(emailOf('m'))[0]!.text).toContain('11/06/2027');
    expect(f.mail.sent.map((m) => m.to)).not.toContain(emailOf('stranger'));
  });

  it('a second run in the same hour, and one later the same day, send nothing more', async () => {
    await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
    const again = await reminders.runForGym(f.gymId, at('2027-06-06', '07:06'));
    const later = await reminders.runForGym(f.gymId, at('2027-06-06', '08:05'));
    expect(again).toMatchObject({ sent: 0, duplicate: 2 });
    expect(later).toMatchObject({ sent: 0, duplicate: 2 });
    expect(f.mail.sent).toHaveLength(2);
  });

  it('two runs at the same moment (two instances) still send one email each', async () => {
    const now = at('2027-06-06', '07:05');
    const [a, b] = await Promise.all([
      reminders.runForGym(f.gymId, now),
      reminders.runForGym(f.gymId, now),
    ]);
    expect(a.sent + b.sent).toBe(2);
    expect(f.mail.sent).toHaveLength(2);
  });

  it('a failed email is retried by the next run and then not repeated', async () => {
    f.mail.failWith = new Error('smtp down');
    const first = await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
    expect(first).toMatchObject({ sent: 0, failed: 2 });
    expect(
      await systemDb.select().from(notificationsSent).where(eq(notificationsSent.gymId, f.gymId)),
    ).toEqual([]);
    f.mail.failWith = null;
    const second = await reminders.runForGym(f.gymId, at('2027-06-06', '08:05'));
    expect(second).toMatchObject({ sent: 2, failed: 0 });
    const third = await reminders.runForGym(f.gymId, at('2027-06-06', '09:05'));
    expect(third).toMatchObject({ sent: 0, duplicate: 2 });
    expect(f.mail.sent).toHaveLength(2);
  });

  it('on the end date the member gets the "expires today" email, once', async () => {
    const run = await reminders.runForGym(f.gymId, at('2027-06-11', '07:05'));
    expect(run.sent).toBe(2);
    expect(emailsOf(emailOf('m'))[0]!.subject).toMatch(/λήγει σήμερα/);
    expect((await reminders.runForGym(f.gymId, at('2027-06-11', '10:05'))).sent).toBe(0);
  });

  it('gives nothing on other days (4 days and 6 days before the end)', async () => {
    expect((await reminders.runForGym(f.gymId, at('2027-06-05', '07:05'))).sent).toBe(0);
    expect((await reminders.runForGym(f.gymId, at('2027-06-07', '07:05'))).sent).toBe(0);
  });

  it('a member who switched the membership email off gets nothing and no row is written', async () => {
    await systemDb.insert(notificationPrefs).values({
      gymId: f.gymId,
      userId: f.id.m!,
      group: 'membership',
      email: false,
      push: false,
    });
    const run = await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
    expect(run).toMatchObject({ sent: 1, optedOut: 1 });
    expect(emailsOf(emailOf('m'))).toEqual([]);
    const rows = await systemDb
      .select()
      .from(notificationsSent)
      .where(eq(notificationsSent.userId, f.id.m!));
    expect(rows).toEqual([]);
  });

  it('a member who already bought the next membership gets no reminder', async () => {
    const [created] = await systemDb
      .insert(users)
      .values({ email: emailOf('rn'), firstName: 'Renewed', lastName: 'Test' })
      .returning({ id: users.id });
    const userId = created!.id;
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId, role: 'member' });
    const type = (await f.req('get', '/membership-types', 'owner').expect(200)).body[0] as {
      id: string;
    };
    const sell = () =>
      f
        .req('post', `/members/${userId}/memberships`, 'rec')
        .send({ typeId: type.id, amountCents: 4000, method: 'cash' })
        .expect(201);
    f.clock.setDay('2027-05-12');
    await sell(); // 12 May - 11 June
    f.clock.setDay('2027-06-02');
    await sell(); // bought early: starts 12 June, the day after the end
    const run = await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
    expect(run.sent).toBe(2); // m and n; the renewed member is skipped
    expect(emailsOf(emailOf('rn'))).toEqual([]);
    expect(emailsOf(emailOf('n'))).toHaveLength(1);
  });

  it('an owner-set lead time of 7 days moves the "expiring" day to 4 June', async () => {
    await f.req('patch', '/settings', 'owner').send({ reminderDays: 7 }).expect(200);
    try {
      expect((await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'))).sent).toBe(0);
      expect((await reminders.runForGym(f.gymId, at('2027-06-04', '07:05'))).sent).toBe(2);
    } finally {
      await f.req('patch', '/settings', 'owner').send({ reminderDays: 5 }).expect(200);
    }
  });

  it('a frozen member gets none while frozen, and one for the new end date after the freeze', async () => {
    const [created] = await systemDb
      .insert(users)
      .values({ email: emailOf('fz'), firstName: 'Freeze', lastName: 'Test' })
      .returning({ id: users.id });
    const userId = created!.id;
    await systemDb.insert(gymRoles).values({ gymId: f.gymId, userId, role: 'member' });
    const type = (
      await f
        .req('post', '/membership-types', 'owner')
        .send({
          name: 'Με πάγωμα',
          kind: 'time',
          durationMonths: 1,
          priceCents: 3000,
          maxFreezeDays: 14,
        })
        .expect(201)
    ).body as { id: string };
    f.clock.setDay('2027-05-12');
    const sold = (
      await f
        .req('post', `/members/${userId}/memberships`, 'rec')
        .send({ typeId: type.id, amountCents: 3000, method: 'cash' })
        .expect(201)
    ).body as { id: string };
    // Ends 11 June. Freeze 4-8 June (5 days): the end moves to 16 June.
    f.clock.setDay('2027-06-02');
    await f
      .req('post', `/memberships/${sold.id}/freezes`, 'rec')
      .send({ startsOn: '2027-06-04', endsOn: '2027-06-08' })
      .expect(201);
    const sentTo = () => emailsOf(emailOf('fz'));
    await reminders.runForGym(f.gymId, at('2027-06-06', '07:05')); // frozen, and the old reminder day
    expect(sentTo()).toEqual([]);
    await reminders.runForGym(f.gymId, at('2027-06-11', '07:05')); // 5 days before 16 June
    expect(sentTo()).toHaveLength(1);
    expect(sentTo()[0]!.text).toContain('16/06/2027');
    await systemDb.delete(notificationsSent).where(eq(notificationsSent.userId, userId));
  });

  it('runAll handles every gym and reminders for one gym never go to another gym’s members', async () => {
    const result = await reminders.runAll(at('2027-06-06', '07:05'));
    expect(result.gyms).toBeGreaterThanOrEqual(2);
    // Each gym reminds its own due member, once.
    expect(emailsOf(emailOf('stranger'))).toHaveLength(1);
    expect(emailsOf(emailOf('m'))).toHaveLength(1);
    // The other gym's membership name never shows up in this gym's members' emails.
    expect(emailsOf(emailOf('m'))[0]!.text).not.toContain('Άλλο γυμναστήριο');
  });

  it('a run for one gym sends nothing to the other gym’s due member', async () => {
    const run = await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
    expect(run).toMatchObject({ sent: 2, failed: 0 });
    expect(emailsOf(emailOf('stranger'))).toEqual([]);
    expect(f.mail.sent.map((m) => m.to).sort()).toEqual([emailOf('m'), emailOf('n')].sort());
  });

  it('only the notification service sends: reminders reuse notify with the documented dedupe keys', async () => {
    const notify = vi.spyOn(f.app.get(NotificationService), 'notify');
    try {
      await reminders.runForGym(f.gymId, at('2027-06-06', '07:05'));
      expect(notify).toHaveBeenCalledTimes(2); // m and n, through the one send path
    } finally {
      notify.mockRestore();
    }
    const rows = await systemDb
      .select()
      .from(notificationsSent)
      .where(eq(notificationsSent.userId, f.id.m!));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe('membership.expiring');
    expect(rows[0]!.dedupeKey).toMatch(/^expiring:[0-9a-f-]{36}:2027-06-11$/);
    const [g] = await systemDb.select({ n: gyms.name }).from(gyms).where(eq(gyms.id, f.gymId));
    expect(emailsOf(emailOf('m'))[0]!.subject).toContain(g!.n);
  });
});
