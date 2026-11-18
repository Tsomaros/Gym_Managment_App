import { randomUUID } from 'node:crypto';
import type { ProgressPhoto } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { systemDb } from '../src/db/client';
import { healthConsents, progressPhotos } from '../src/db/schema';
import { StorageService } from '../src/storage/storage.service';
import { DAY, type HealthFixture, s3Reachable, setupHealthFixture } from './helpers/fixture';

const jpeg = (size = 64): Buffer => {
  const b = Buffer.alloc(size, 1);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b);
  return b;
};

/** What goes wrong around the object store: failures must never leave a row without its file or a file nobody can delete. */
describe('progress photos: storage failures and limits (MinIO)', () => {
  let fx: HealthFixture;
  let reachable = false;
  const s3it = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!reachable) ctx.skip('nothing listens on S3_ENDPOINT: run `docker compose up -d`');
      await fn();
    });

  beforeAll(async () => {
    reachable = await s3Reachable();
    fx = await setupHealthFixture('PF');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(progressPhotos).where(eq(progressPhotos.gymId, g));
      await systemDb.delete(healthConsents).where(eq(healthConsents.gymId, g));
    }),
  );

  const storage = () => fx.app.get(StorageService);
  const upload = (who: string, member = 'm') =>
    fx
      .req('post', `/members/${fx.id[member]}/progress-photos`, who)
      .field('takenOn', DAY)
      .attach('photo', jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' });
  const rows = (member = 'm') =>
    systemDb.select().from(progressPhotos).where(eq(progressPhotos.memberId, fx.id[member]!));
  const status = async (url: string) => (await fetch(url)).status;

  s3it('a failure after the row is committed keeps both the row and its object', async () => {
    await fx.req('post', '/me/consents/photos', 'm').expect(201);
    vi.spyOn(StorageService.prototype, 'signedGetUrl').mockRejectedValueOnce(new Error('boom'));
    await upload('m').expect(500);
    vi.restoreAllMocks();
    const stored = await rows();
    expect(stored).toHaveLength(1);
    const [photo] = (await fx.req('get', '/me/progress-photos', 'm').expect(200))
      .body as ProgressPhoto[];
    expect(await status(photo!.url)).toBe(200); // the object is still there
  });

  s3it('withdrawing again removes objects an earlier failed delete left behind', async () => {
    await upload('m').expect(201);
    const before = (await fx.req('get', '/me/progress-photos', 'm').expect(200))
      .body as ProgressPhoto[];
    expect(before).toHaveLength(2);
    // storage is down for the first withdrawal: rows go, objects stay
    vi.spyOn(StorageService.prototype, 'remove').mockRejectedValue(new Error('storage down'));
    vi.spyOn(StorageService.prototype, 'removePrefix').mockRejectedValueOnce(
      new Error('storage down'),
    );
    await fx.req('delete', '/me/consents/photos', 'm').expect(204);
    vi.restoreAllMocks();
    expect(await rows()).toHaveLength(0);
    expect(await status(before[0]!.url)).toBe(200); // orphaned, unreachable by any row
    // the member withdraws again (nothing left to withdraw): the sweep still deletes them
    await fx.req('delete', '/me/consents/photos', 'm').expect(204);
    for (const p of before) expect(await status(p.url)).toBe(404);
  });

  s3it('an upload racing a withdrawal leaves no row and no object behind', async () => {
    await fx.req('post', '/me/consents/photos', 'm').expect(201);
    const results = await Promise.all([
      upload('m'),
      upload('m'),
      fx.req('delete', '/me/consents/photos', 'm'),
    ]);
    expect(results[2]!.status).toBe(204);
    for (const r of results.slice(0, 2)) expect([201, 409]).toContain(r.status);
    // whatever the order, nothing of the member survives the withdrawal
    expect(await rows()).toHaveLength(0);
    const listed = await storage().listPrefix(`gyms/${fx.gymId}/progress/${fx.id.m}/`);
    expect(listed).toEqual([]);
  });

  s3it('a photo sent without a day is dated by the gym’s calendar, not the sender’s', async () => {
    await fx.req('post', '/me/consents/photos', 'm').expect(201);
    fx.clock.current = new Date('2027-05-11T22:30:00Z'); // 00:30 in Athens on the 12th
    const res = await fx
      .req('post', `/members/${fx.id.m}/progress-photos`, 'm')
      .attach('photo', jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.takenOn).toBe('2027-05-12');
    fx.clock.setDay(DAY);
  });

  s3it('refuses the 201st photo of a member (storage and the list stay bounded)', async () => {
    await fx.req('post', '/me/consents/photos', 'n').expect(201);
    await systemDb.insert(progressPhotos).values(
      Array.from({ length: 200 }, () => ({
        gymId: fx.gymId,
        memberId: fx.id.n!,
        takenOn: DAY,
        objectKey: `gyms/${fx.gymId}/progress/${fx.id.n}/${randomUUID()}.jpg`,
      })),
    );
    const res = await upload('n', 'n').expect(409);
    expect(res.body.message).toBe('Too many photos');
    expect(await rows('n')).toHaveLength(200);
    expect(await storage().listPrefix(`gyms/${fx.gymId}/progress/${fx.id.n}/`)).toEqual([]);
  });
});
