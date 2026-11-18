import type { AuditPage, ProgressPhoto } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { healthConsents, progressPhotos, trainerCovers } from '../src/db/schema';
import { DAY, type HealthFixture, s3Reachable, setupHealthFixture } from './helpers/fixture';

const jpeg = (size = 64, fill = 1): Buffer => {
  const b = Buffer.alloc(size, fill);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b);
  return b;
};

describe('progress photos (MinIO): consent, access, withdrawal deletes the objects', () => {
  let fx: HealthFixture;
  let reachable = false;
  /** Skips with a reason when nothing listens on S3_ENDPOINT (CI has no MinIO). */
  const s3it = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!reachable) ctx.skip('nothing listens on S3_ENDPOINT: run `docker compose up -d`');
      await fn();
    });

  beforeAll(async () => {
    reachable = await s3Reachable();
    fx = await setupHealthFixture('PH');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(progressPhotos).where(eq(progressPhotos.gymId, g));
      await systemDb.delete(healthConsents).where(eq(healthConsents.gymId, g));
    }),
  );

  const upload = (
    who: string,
    member: string,
    body: Buffer,
    over: { takenOn?: string; filename?: string } = {},
  ) =>
    fx
      .req('post', `/members/${fx.id[member]}/progress-photos`, who)
      .field('takenOn', over.takenOn ?? DAY)
      .attach('photo', body, { filename: over.filename ?? 'p.jpg', contentType: 'image/jpeg' });
  const list = async (who: string, member = 'm') =>
    (await fx.req('get', `/members/${fx.id[member]}/progress-photos`, who).expect(200))
      .body as ProgressPhoto[];
  const grant = (who: string, kind = 'photos') => fx.req('post', `/me/consents/${kind}`, who);
  const objectStatus = async (url: string) => (await fetch(url)).status;

  s3it(
    'uploading without photo consent is a 409 and stores nothing (measurement consent is not enough)',
    async () => {
      await grant('m', 'measurements').expect(201);
      const res = await upload('m', 'm', jpeg()).expect(409);
      expect(res.body.message).toBe('No consent');
      await upload('t', 'm', jpeg()).expect(409);
      expect(
        await systemDb.select().from(progressPhotos).where(eq(progressPhotos.memberId, fx.id.m!)),
      ).toHaveLength(0);
    },
  );

  s3it(
    'after consent the member and the primary trainer add photos; both list them with a working 5-minute link',
    async () => {
      await grant('m').expect(201);
      const bytes = jpeg(2048, 7);
      const mine = (await upload('m', 'm', bytes).expect(201)).body as ProgressPhoto;
      expect(mine).toMatchObject({ takenOn: DAY, uploadedBy: fx.id.m });
      const byTrainer = (
        await upload('t', 'm', jpeg(512, 9), { takenOn: '2027-05-10' }).expect(201)
      ).body as ProgressPhoto;
      expect(byTrainer.uploadedBy).toBe(fx.id.t);

      const asTrainer = await list('t');
      expect(asTrainer.map((p) => p.id)).toEqual([mine.id, byTrainer.id]); // newest day first
      const asMember = (await fx.req('get', '/me/progress-photos', 'm').expect(200))
        .body as ProgressPhoto[];
      expect(asMember.map((p) => p.id)).toEqual([mine.id, byTrainer.id]);
      const res = await fetch(asTrainer[0]!.url);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
      expect(new URL(asTrainer[0]!.url).searchParams.get('X-Amz-Expires')).toBe('300');
      // the key is under the member's own folder and never exposed
      const [row] = await systemDb
        .select()
        .from(progressPhotos)
        .where(eq(progressPhotos.id, mine.id));
      expect(row!.objectKey).toMatch(
        new RegExp(`^gyms/${fx.gymId}/progress/${fx.id.m}/[0-9a-f-]{36}\\.jpg$`),
      );
      // only the signed link carries the key; no field exposes it
      for (const p of asTrainer) {
        expect(Object.keys(p).sort()).toEqual(['id', 'takenOn', 'uploadedBy', 'url']);
      }
    },
  );

  s3it('a cover trainer lists today but cannot upload or delete; the next day, 404', async () => {
    await systemDb
      .insert(trainerCovers)
      .values({ gymId: fx.gymId, memberId: fx.id.m!, trainerId: fx.id.u!, date: DAY });
    const [first] = await list('u');
    await upload('u', 'm', jpeg()).expect(403);
    await fx.req('delete', `/members/${fx.id.m}/progress-photos/${first!.id}`, 'u').expect(403);
    fx.clock.setDay('2027-05-13');
    await fx.req('get', `/members/${fx.id.m}/progress-photos`, 'u').expect(404);
    fx.clock.setDay(DAY);
    await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, fx.gymId));
  });

  s3it('owner, reception, another member and a stranger’s trainer get 404', async () => {
    const [first] = await list('t');
    for (const who of ['owner', 'rec', 'n', 'u']) {
      await fx.req('get', `/members/${fx.id.m}/progress-photos`, who).expect(404);
      await upload(who, 'm', jpeg()).expect(404);
      await fx.req('delete', `/members/${fx.id.m}/progress-photos/${first!.id}`, who).expect(404);
    }
  });

  s3it(
    'rejects a wrong type (415), a file over 3 MB (413), a future or missing day (400) and no file (415)',
    async () => {
      await upload('m', 'm', Buffer.from('not an image at all')).expect(415);
      await upload('m', 'm', jpeg(3 * 1024 * 1024 + 1024)).expect(413);
      await upload('m', 'm', jpeg(), { takenOn: '2027-05-13' }).expect(400);
      await upload('m', 'm', jpeg(), { takenOn: 'yesterday' }).expect(400);
      await fx
        .req('post', `/members/${fx.id.m}/progress-photos`, 'm')
        .attach('photo', jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(400); // no takenOn
      await fx
        .req('post', `/members/${fx.id.m}/progress-photos`, 'm')
        .field('takenOn', DAY)
        .expect(415);
      // exactly 3 MB is fine
      await upload('m', 'm', jpeg(3 * 1024 * 1024)).expect(201);
    },
  );

  s3it('deleting a photo removes the row and the object; the history keeps no key', async () => {
    const before = await list('t');
    const victim = before.at(-1)!;
    await fx.req('delete', `/members/${fx.id.m}/progress-photos/${victim.id}`, 'n').expect(404);
    expect(await objectStatus(victim.url)).toBe(200);
    await fx.req('delete', `/members/${fx.id.m}/progress-photos/${victim.id}`, 't').expect(204);
    expect((await list('t')).map((p) => p.id)).not.toContain(victim.id);
    expect(await objectStatus(victim.url)).toBe(404);
    await fx.req('delete', `/members/${fx.id.m}/progress-photos/${victim.id}`, 't').expect(404);
    const page = (
      await fx.req('get', '/audit?entity=progress_photo&limit=100', 'owner').expect(200)
    ).body as AuditPage;
    expect(page.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['progress_photo.added', 'progress_photo.deleted']),
    );
    for (const e of page.entries) {
      expect(e.data).toEqual({ memberId: fx.id.m });
    }
  });

  s3it(
    'withdrawing photo consent deletes every photo row and storage object of that member only',
    async () => {
      await grant('n').expect(201);
      await upload('n', 'n', jpeg(100, 5)).expect(201);
      const mine = await list('t');
      expect(mine.length).toBeGreaterThan(1);
      const theirs = await list('t', 'n');
      expect(theirs).toHaveLength(1);

      await fx.req('delete', '/me/consents/photos', 'm').expect(204);
      expect(await list('t')).toEqual([]);
      expect(
        await systemDb.select().from(progressPhotos).where(eq(progressPhotos.memberId, fx.id.m!)),
      ).toHaveLength(0);
      for (const p of mine) expect(await objectStatus(p.url)).toBe(404);
      // another member's photo and its object survive
      expect(await objectStatus(theirs[0]!.url)).toBe(200);
      expect(await list('t', 'n')).toHaveLength(1);

      const page = (
        await fx.req('get', '/audit?entity=health_consent&limit=100', 'owner').expect(200)
      ).body as AuditPage;
      const w = page.entries.find(
        (e) =>
          e.action === 'consent.withdrawn' && e.data.kind === 'photos' && e.actor?.id === fx.id.m,
      )!;
      expect(w.data).toEqual({ kind: 'photos', deleted: mine.length });
      // no consent now: uploading is a 409 again
      await upload('t', 'm', jpeg()).expect(409);
    },
  );

  s3it('is per gym: a member of the other gym has their own photos and consent', async () => {
    await fx.req('post', '/me/consents/photos', 'stranger', fx.otherGymId).expect(201);
    await fx
      .req('post', `/members/${fx.id.stranger}/progress-photos`, 'stranger', fx.otherGymId)
      .field('takenOn', DAY)
      .attach('photo', jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await fx.req('get', `/members/${fx.id.stranger}/progress-photos`, 't').expect(404);
    const rows = await systemDb
      .select()
      .from(progressPhotos)
      .where(eq(progressPhotos.memberId, fx.id.stranger!));
    expect(rows.map((r) => r.gymId)).toEqual([fx.otherGymId]);
  });
});
