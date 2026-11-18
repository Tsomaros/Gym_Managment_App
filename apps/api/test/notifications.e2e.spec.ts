import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { notificationPrefs, pushSubscriptions } from '../src/db/schema';
import { type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('notification settings and push subscriptions', () => {
  let f: HealthFixture;
  const sub = (n: string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${f.run}/${n}`,
    expirationTime: null,
    keys: { p256dh: 'BPublicKeyData', auth: 'authSecret' },
  });
  const put = (who: string, body: unknown) =>
    request(f.app.getHttpServer())
      .put('/me/push-subscriptions')
      .auth(f.tok[who]!, { type: 'bearer' })
      .send(body as object);
  const rows = (who: string) =>
    systemDb.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, f.id[who]!));

  beforeAll(async () => {
    f = await setupHealthFixture('Notif');
  });
  afterAll(async () => {
    await f.cleanup();
  });

  it('serves the public VAPID key without signing in', async () => {
    const res = await request(f.app.getHttpServer()).get('/push/vapid-public-key').expect(200);
    expect(typeof res.body.key).toBe('string');
    expect(res.body.key.length).toBeGreaterThan(0);
    expect(res.body).toEqual({ key: process.env.VAPID_PUBLIC_KEY });
  });

  it('subscribing needs a signed-in user and a valid subscription', async () => {
    await request(f.app.getHttpServer()).put('/me/push-subscriptions').send(sub('a')).expect(401);
    await put('m', { endpoint: 'not a url', keys: { p256dh: 'x', auth: 'y' } }).expect(400);
    await put('m', { endpoint: sub('a').endpoint }).expect(400);
  });

  it('refuses endpoints that are not a real push service (no server-side requests to internal hosts)', async () => {
    for (const endpoint of [
      'http://127.0.0.1:1/x',
      'http://fcm.googleapis.com/x',
      'https://localhost:9000/x',
      'https://169.254.169.254/latest',
      'https://evil.example/x',
      'https://fcm.googleapis.com.evil.example/x',
    ]) {
      await put('m', { ...sub('a'), endpoint }).expect(400);
    }
    await put('m', {
      ...sub('a'),
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x',
    }).expect(204);
    await put('m', { ...sub('a'), endpoint: 'https://web.push.apple.com/Qx' }).expect(204);
    await systemDb.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, f.id.m!));
  });

  it('stores a subscription for the caller; the same call again keeps one row', async () => {
    await put('m', sub('a')).expect(204);
    await put('m', sub('a')).expect(204);
    expect(await rows('m')).toHaveLength(1);
  });

  it('the same browser subscribing from a second account moves the row to that account', async () => {
    await put('m', sub('shared')).expect(204);
    await put('n', sub('shared')).expect(204);
    expect((await rows('m')).map((r) => r.endpoint)).not.toContain(sub('shared').endpoint);
    expect((await rows('n')).map((r) => r.endpoint)).toContain(sub('shared').endpoint);
  });

  it('unsubscribing removes only the caller’s own subscription', async () => {
    const del = (who: string) =>
      request(f.app.getHttpServer())
        .delete('/me/push-subscriptions')
        .auth(f.tok[who]!, { type: 'bearer' })
        .send({ endpoint: sub('shared').endpoint });
    await del('m').expect(204);
    expect((await rows('n')).map((r) => r.endpoint)).toContain(sub('shared').endpoint);
    await del('n').expect(204);
    expect((await rows('n')).map((r) => r.endpoint)).not.toContain(sub('shared').endpoint);
  });

  it('prefs default to everything on, and a PUT is read back per gym and per member', async () => {
    const on = { email: true, push: true };
    expect((await f.req('get', '/me/notification-prefs', 'm').expect(200)).body).toEqual({
      membership: on,
      plans: on,
      classes: on,
    });
    const next = {
      membership: { email: false, push: true },
      plans: { email: true, push: false },
      classes: { email: false, push: false },
    };
    expect((await f.req('put', '/me/notification-prefs', 'm').send(next).expect(200)).body).toEqual(
      next,
    );
    expect((await f.req('get', '/me/notification-prefs', 'm').expect(200)).body).toEqual(next);
    // Another member of the same gym is unaffected.
    expect((await f.req('get', '/me/notification-prefs', 'n').expect(200)).body).toEqual({
      membership: on,
      plans: on,
      classes: on,
    });
    // A second PUT updates the rows instead of adding more.
    await f
      .req('put', '/me/notification-prefs', 'm')
      .send({ membership: on, plans: on, classes: on })
      .expect(200);
    expect(
      await systemDb.select().from(notificationPrefs).where(eq(notificationPrefs.userId, f.id.m!)),
    ).toHaveLength(3);
  });

  it('rejects an incomplete prefs body', async () => {
    await f
      .req('put', '/me/notification-prefs', 'm')
      .send({ membership: { email: true, push: true } })
      .expect(400);
  });

  it('prefs are for members only and for the gym the caller belongs to', async () => {
    await f.req('get', '/me/notification-prefs', 't').expect(403);
    await f.req('get', '/me/notification-prefs', 'stranger').expect(403); // a member of the other gym
    const all = { email: false, push: false };
    await f
      .req('put', '/me/notification-prefs', 'stranger')
      .send({ membership: all, plans: all })
      .expect(403);
    expect(
      await systemDb
        .select()
        .from(notificationPrefs)
        .where(eq(notificationPrefs.userId, f.id.stranger!)),
    ).toEqual([]);
  });

  it('a malformed gym id is a 400, not a 500', async () => {
    await request(f.app.getHttpServer())
      .get('/gyms/not-a-uuid/me/notification-prefs')
      .auth(f.tok.m!, { type: 'bearer' })
      .expect(400);
  });
});
