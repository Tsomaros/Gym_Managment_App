import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, systemDb } from '../../src/db/client';
import {
  gymRoles,
  gyms,
  notificationPrefs,
  notificationsSent,
  pushSubscriptions,
  users,
} from '../../src/db/schema';
import type { MailMessage } from '../../src/mail/mail.service';
import { NotificationService } from '../../src/notifications/notification.service';
import { PushService, type PushTransport } from '../../src/notifications/push.service';

/** Records sends; `failWith` makes sends throw; `gate` holds a send until released. */
class FakeMail {
  sent: MailMessage[] = [];
  failWith: Error | null = null;
  gate: Promise<void> | null = null;
  async send(msg: MailMessage): Promise<void> {
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    this.sent.push(msg);
  }
}

class FakeTransport implements PushTransport {
  sent: { endpoint: string; payload: string }[] = [];
  /** endpoint -> HTTP status the push service answers with */
  status = new Map<string, number>();
  async send(sub: { endpoint: string }, payload: string): Promise<void> {
    const code = this.status.get(sub.endpoint);
    if (code) throw Object.assign(new Error(`push ${code}`), { statusCode: code });
    this.sent.push({ endpoint: sub.endpoint, payload });
  }
}

afterAll(async () => {
  await closeDb();
});

describe('NotificationService', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let member: string;
  let staff: string;
  let mail: FakeMail;
  let transport: FakeTransport;
  let service: NotificationService;
  let key = 0;
  const ep = (n: string) => `https://push.example/${run}/${n}`;

  const event = (over: Partial<Parameters<NotificationService['notify']>[0]> = {}) => ({
    gymId: gymA,
    userId: member,
    event: 'membership.expiring' as const,
    dedupeKey: `expiring:${run}:${++key}`,
    params: { membershipName: 'Μηνιαία', endsOn: '2027-05-31', days: 5 },
    ...over,
  });
  const subscribe = (endpoint: string, userId = member) =>
    systemDb.insert(pushSubscriptions).values({ userId, endpoint, p256dh: 'p', auth: 'a' });
  const sentRows = (gym = gymA) =>
    systemDb.select().from(notificationsSent).where(eq(notificationsSent.gymId, gym));

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Ntf A ${run}` }, { name: `Ntf B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `m-${run}@x.gr`, firstName: 'Μαρία', lastName: 'Μ' },
        { email: `s-${run}@x.gr`, firstName: 'Στέλιος', lastName: 'Σ' },
      ])
      .returning({ id: users.id });
    member = u[0]!.id;
    staff = u[1]!.id;
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: member, role: 'member' },
      { gymId: gymA, userId: staff, role: 'trainer' },
      { gymId: gymB, userId: member, role: 'member' },
    ]);
  });

  afterAll(async () => {
    await systemDb.delete(gymRoles).where(sql`${gymRoles.gymId} in (${gymA}, ${gymB})`);
    await systemDb.delete(gyms).where(sql`${gyms.id} in (${gymA}, ${gymB})`);
    await systemDb.delete(users).where(sql`${users.email} like ${`_-${run}@x.gr`}`);
  });

  beforeEach(async () => {
    mail = new FakeMail();
    transport = new FakeTransport();
    service = new NotificationService(mail as never, new PushService(transport));
    await systemDb.delete(notificationsSent).where(eq(notificationsSent.userId, member));
    await systemDb.delete(notificationPrefs).where(eq(notificationPrefs.userId, member));
    await systemDb.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, member));
    await systemDb.update(users).set({ locale: 'el' }).where(eq(users.id, member));
  });

  it('sends once: the same dedupe key gives "sent" and then "duplicate", with one email and one push', async () => {
    await subscribe(ep('1'));
    const e = event();
    expect(await service.notify(e)).toBe('sent');
    expect(await service.notify(e)).toBe('duplicate');
    expect(mail.sent).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
    const rows = await sentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channels.sort()).toEqual(['email', 'push']);
  });

  it('two concurrent calls with one key send once (the second waits for the first, then sees its row)', async () => {
    let release!: () => void;
    mail.gate = new Promise<void>((r) => (release = r));
    const e = event();
    const first = service.notify(e);
    // Let the first call reach the (held) send before the second one starts.
    await new Promise((r) => setTimeout(r, 150));
    const second = service.notify(e);
    await new Promise((r) => setTimeout(r, 150));
    release();
    expect([await first, await second].sort()).toEqual(['duplicate', 'sent']);
    expect(mail.sent).toHaveLength(1);
    expect(await sentRows()).toHaveLength(1);
  });

  it('a push endpoint that answers 410 loses its subscription and the email still goes out', async () => {
    await subscribe(ep('gone'));
    transport.status.set(ep('gone'), 410);
    expect(await service.notify(event())).toBe('sent');
    expect(mail.sent).toHaveLength(1);
    expect((await sentRows())[0]!.channels).toEqual(['email']);
    const left = await systemDb
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, member));
    expect(left).toEqual([]);
  });

  it('a 404 also removes the subscription, but a 500 keeps it', async () => {
    await subscribe(ep('404'));
    await subscribe(ep('500'));
    transport.status.set(ep('404'), 404);
    transport.status.set(ep('500'), 500);
    expect(await service.notify(event())).toBe('sent');
    const left = await systemDb
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, member));
    expect(left.map((l) => l.endpoint)).toEqual([ep('500')]);
  });

  it('with the membership email off and push on, only push goes out', async () => {
    await subscribe(ep('1'));
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: gymA, userId: member, group: 'membership', email: false });
    expect(await service.notify(event())).toBe('sent');
    expect(mail.sent).toEqual([]);
    expect(transport.sent).toHaveLength(1);
    expect((await sentRows())[0]!.channels).toEqual(['push']);
  });

  it('the plans group is separate: switching membership email off does not stop a plan email', async () => {
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: gymA, userId: member, group: 'membership', email: false });
    expect(
      await service.notify(event({ event: 'plan.assigned', params: { planName: 'Push/Pull' } })),
    ).toBe('sent');
    expect(mail.sent).toHaveLength(1);
  });

  it('with both channels off the result is "opted_out" and no row is written', async () => {
    await subscribe(ep('1'));
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: gymA, userId: member, group: 'membership', email: false, push: false });
    expect(await service.notify(event())).toBe('opted_out');
    expect(mail.sent).toEqual([]);
    expect(transport.sent).toEqual([]);
    expect(await sentRows()).toEqual([]);
  });

  it('email off and no push subscription means nothing can be sent: "opted_out", not a retry loop', async () => {
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: gymA, userId: member, group: 'membership', email: false });
    expect(await service.notify(event())).toBe('opted_out');
    expect(await sentRows()).toEqual([]);
  });

  it('a failing email with no push subscription gives "failed" and no row; a later call sends', async () => {
    mail.failWith = new Error('smtp down');
    const e = event();
    expect(await service.notify(e)).toBe('failed');
    expect(await sentRows()).toEqual([]);
    mail.failWith = null;
    expect(await service.notify(e)).toBe('sent');
    expect(mail.sent).toHaveLength(1);
  });

  it('a failing email with a working push is "sent" with the push channel only', async () => {
    await subscribe(ep('1'));
    mail.failWith = new Error('smtp down');
    expect(await service.notify(event())).toBe('sent');
    expect((await sentRows())[0]!.channels).toEqual(['push']);
  });

  it('renders in the persons language, with the gym name in the subject and a settings link', async () => {
    await systemDb.update(users).set({ locale: 'en' }).where(eq(users.id, member));
    await subscribe(ep('1'));
    await service.notify(
      event({ params: { membershipName: 'Monthly', endsOn: '2027-05-31', days: 5 } }),
    );
    expect(mail.sent[0]!.to).toBe(`m-${run}@x.gr`);
    expect(mail.sent[0]!.subject).toContain(`Ntf A ${run}`);
    expect(mail.sent[0]!.subject).toMatch(/expires|expiring/i);
    expect(mail.sent[0]!.text).toContain('/settings/notifications');
    expect(mail.sent[0]!.text).toContain('31/05/2027');
    const payload = JSON.parse(transport.sent[0]!.payload) as Record<string, string>;
    expect(Object.keys(payload).sort()).toEqual(['body', 'title', 'url']);
    expect(payload.body).toMatch(/Monthly/);
  });

  it('renders Greek by default and never puts an amount in the push payload', async () => {
    await subscribe(ep('1'));
    await service.notify(
      event({
        params: { membershipName: 'Μηνιαία', endsOn: '2027-05-31', days: 5, priceCents: 4500 },
      }),
    );
    expect(mail.sent[0]!.subject).toMatch(/λήγ/);
    expect(transport.sent[0]!.payload).not.toMatch(/4500|45[.,]00|€/);
  });

  it('staff are not recipients: a trainer gets nothing and no row is written', async () => {
    expect(await service.notify(event({ userId: staff }))).toBe('opted_out');
    expect(mail.sent).toEqual([]);
    expect(await sentRows()).toEqual([]);
  });

  it('a different dedupe key is a new send (dedupe is per key, not per person and event)', async () => {
    expect(await service.notify(event())).toBe('sent');
    expect(await service.notify(event())).toBe('sent');
    expect(mail.sent).toHaveLength(2);
    expect(await sentRows()).toHaveLength(2);
  });

  it('a person who is a member only of another gym gets nothing from this gym', async () => {
    const [o] = await systemDb
      .insert(users)
      .values({ email: `o-${run}@x.gr`, firstName: 'Ορέστης', lastName: 'Ο' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: gymB, userId: o!.id, role: 'member' });
    expect(await service.notify(event({ userId: o!.id }))).toBe('opted_out');
    expect(mail.sent).toEqual([]);
    expect(await sentRows()).toEqual([]);
  });

  it('push only, and the endpoint is gone: "failed", no row, and the dead subscription is removed', async () => {
    await subscribe(ep('dead'));
    transport.status.set(ep('dead'), 410);
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: gymA, userId: member, group: 'membership', email: false });
    expect(await service.notify(event())).toBe('failed');
    expect(await sentRows()).toEqual([]);
    expect(mail.sent).toEqual([]);
    expect(
      await systemDb.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, member)),
    ).toEqual([]);
  });

  it('the same key in another gym is a separate send', async () => {
    const e = event();
    expect(await service.notify(e)).toBe('sent');
    expect(await service.notify({ ...e, gymId: gymB })).toBe('sent');
    expect(mail.sent).toHaveLength(2);
  });

  it('prefs are per gym: switching push off in gym A does not affect gym B', async () => {
    await subscribe(ep('1'));
    await systemDb
      .insert(notificationPrefs)
      .values({ gymId: gymA, userId: member, group: 'membership', push: false });
    await service.notify(event());
    await service.notify(event({ gymId: gymB }));
    expect(transport.sent).toHaveLength(1);
    const b = await systemDb
      .select()
      .from(notificationsSent)
      .where(and(eq(notificationsSent.gymId, gymB), eq(notificationsSent.userId, member)));
    expect(b[0]!.channels.sort()).toEqual(['email', 'push']);
  });
});
