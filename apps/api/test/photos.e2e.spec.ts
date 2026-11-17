import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CheckInResult, MemberDetail } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { systemDb } from '../src/db/client';
import { auditLog, checkIns, gymRoles, gyms, memberPhotos, users } from '../src/db/schema';
import { configureApp } from '../src/main';
import { useTestDatabase } from './test-env';

useTestDatabase(); // loads .env so S3_ENDPOINT is known before the reachability check

/** True when something listens on the S3 endpoint (MinIO from docker compose). */
async function s3Reachable(): Promise<boolean> {
  const url = new URL(process.env.S3_ENDPOINT ?? 'http://localhost:9000');
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) || 80 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}


/** Not a real image: the server checks the first bytes, not that the file decodes. */
const jpeg = (size = 64, fill = 1): Buffer => {
  const b = Buffer.alloc(size, fill);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b);
  return b;
};
const png = (): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);
const webp = (): Buffer =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.from([32, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(32, 3)]);

describe('member photos (MinIO)', () => {
  let reachable = false;
  /** Skips with a reason when nothing listens on S3_ENDPOINT (CI has no MinIO). */
  const s3it = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!reachable) ctx.skip('nothing listens on S3_ENDPOINT: run `docker compose up -d`');
      await fn();
    });
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let gymA: string;
  let gymB: string;
  let reception: string;
  let trainer: string;
  let owner: string;
  let receptionB: string;
  let memberToken: string;
  let memberA: string;
  let outsider: string;
  const server = () => app.getHttpServer();

  const upload = (token: string, member: string, body: Buffer, filename = 'me.jpg', gym = gymA) =>
    request(server())
      .put(`/gyms/${gym}/members/${member}/photo`)
      .auth(token, { type: 'bearer' })
      .attach('photo', body, { filename, contentType: 'image/jpeg' });
  const detail = async (member = memberA): Promise<MemberDetail> =>
    (
      await request(server())
        .get(`/gyms/${gymA}/members/${member}`)
        .auth(reception, { type: 'bearer' })
        .expect(200)
    ).body as MemberDetail;
  const fetchBytes = async (url: string) => {
    const res = await fetch(url);
    return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
  };

  beforeAll(async () => {
    reachable = await s3Reachable();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();

    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Photos A ${run}` }, { name: `Photos B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values(
        ['rec', 'trainer', 'mem', 'out', 'own', 'recb'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n === 'mem' ? 'Μαρία' : n,
          lastName: 'Test',
        })),
      )
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: u[0]!.id, role: 'reception' },
      { gymId: gymA, userId: u[1]!.id, role: 'trainer' },
      { gymId: gymA, userId: u[2]!.id, role: 'member' },
      { gymId: gymB, userId: u[3]!.id, role: 'member' },
      { gymId: gymA, userId: u[4]!.id, role: 'owner' },
      { gymId: gymB, userId: u[5]!.id, role: 'reception' },
    ]);
    const sign = (id: string) => signAccessToken({ sub: id, adm: false });
    owner = sign(u[4]!.id);
    receptionB = sign(u[5]!.id);
    memberToken = sign(u[2]!.id);
    reception = sign(u[0]!.id);
    trainer = sign(u[1]!.id);
    memberA = u[2]!.id;
    outsider = u[3]!.id;
  });

  afterAll(async () => {
    for (const id of [gymA, gymB].filter(Boolean)) {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, id));
      await systemDb.delete(memberPhotos).where(eq(memberPhotos.gymId, id));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, id));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, id));
      await systemDb.delete(gyms).where(eq(gyms.id, id));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  s3it('has no photo to begin with', async () => {
    expect((await detail()).photoUrl).toBeNull();
  });

  s3it('stores an upload and serves the same bytes through a signed link; a second upload replaces it and deletes the old object', async () => {
    const first = jpeg(200, 7);
    await upload(reception, memberA, first).expect(200);
    const url1 = (await detail()).photoUrl!;
    expect(url1).toMatch(/^http/);
    expect(url1).toContain('X-Amz-Expires=300');
    expect(url1).toContain(`/gyms/${gymA}/members/${memberA}/`);
    const got = await fetchBytes(url1);
    expect(got.status).toBe(200);
    expect(got.bytes.equals(first)).toBe(true);

    const second = jpeg(300, 9);
    await upload(reception, memberA, second).expect(200);
    const url2 = (await detail()).photoUrl!;
    expect(url2).not.toBe(url1);
    expect((await fetchBytes(url2)).bytes.equals(second)).toBe(true);
    expect((await fetchBytes(url1)).status).toBe(404);
    expect(await systemDb.select().from(memberPhotos).where(eq(memberPhotos.memberId, memberA))).toHaveLength(1);
  });

  s3it('survives two simultaneous first uploads: both 200, one row, one stored object, no orphan', async () => {
    const fresh = randomUUID();
    const [u] = await systemDb
      .insert(users)
      .values({ email: `fresh-${fresh.slice(0, 6)}-${run}@x.gr`, firstName: 'Νέα', lastName: 'Φωτο' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: gymA, userId: u!.id, role: 'member' });
    const [a, b] = await Promise.all([
      upload(reception, u!.id, jpeg(100, 4)),
      upload(reception, u!.id, jpeg(100, 5)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const rows = await systemDb.select().from(memberPhotos).where(eq(memberPhotos.memberId, u!.id));
    expect(rows).toHaveLength(1);
    // the loser's object was replaced and deleted, the winner's is served
    const url = (await detail(u!.id)).photoUrl!;
    expect((await fetchBytes(url)).status).toBe(200);
    const listing = await new Promise<number>((resolve) => {
      void import('@aws-sdk/client-s3').then(async ({ S3Client, ListObjectsV2Command }) => {
        const c = new S3Client({
          endpoint: process.env.S3_ENDPOINT,
          region: process.env.S3_REGION ?? 'us-east-1',
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
          },
        });
        const out = await c.send(
          new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET!,
            Prefix: `gyms/${gymA}/members/${u!.id}/`,
          }),
        );
        resolve(out.KeyCount ?? 0);
      });
    });
    expect(listing).toBe(1);
  });

  s3it('accepts PNG and WebP by their first bytes, whatever the file is called', async () => {
    const p = png();
    await upload(reception, memberA, p, 'a.txt').expect(200);
    const gotPng = await fetch((await detail()).photoUrl!);
    // the stored type follows the bytes, not the name or the claimed image/jpeg
    expect(gotPng.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await gotPng.arrayBuffer()).equals(p)).toBe(true);
    await upload(reception, memberA, webp(), 'b.png').expect(200);
    expect((await fetch((await detail()).photoUrl!)).headers.get('content-type')).toBe('image/webp');
  });

  s3it('refuses look-alike files: RIFF that is not WebP, GIF, a PNG cut short, a lone JPEG marker', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([32, 0, 0, 0]), Buffer.from('WAVE'), Buffer.alloc(32)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]);
    const pngCut = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const jpegPrefix = Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00]);
    for (const bad of [wav, gif, pngCut, jpegPrefix]) {
      await upload(reception, memberA, bad, 'x.jpg').expect(415);
    }
  });

  s3it('answers 415 for a text file renamed .jpg and for an empty upload, and keeps the existing photo', async () => {
    const before = (await detail()).photoUrl;
    await upload(reception, memberA, Buffer.from('hello, not an image at all'), 'x.jpg').expect(415);
    await upload(reception, memberA, Buffer.alloc(0), 'x.jpg').expect(415);
    await request(server())
      .put(`/gyms/${gymA}/members/${memberA}/photo`)
      .auth(reception, { type: 'bearer' })
      .expect(415);
    expect(before).not.toBeNull();
    expect((await detail()).photoUrl).not.toBeNull();
  });

  s3it('answers 413 for 2.1 MB and accepts exactly 2 MB', async () => {
    await upload(reception, memberA, jpeg(2 * 1024 * 1024 + 100_000)).expect(413);
    await upload(reception, memberA, jpeg(2 * 1024 * 1024 + 1)).expect(413); // one byte over
    const exact = jpeg(2 * 1024 * 1024, 5);
    await upload(reception, memberA, exact).expect(200);
    expect((await fetchBytes((await detail()).photoUrl!)).bytes.equals(exact)).toBe(true);
  });

  s3it('answers 403 to a trainer, 404 to someone who is not a member of this gym, 401 without a token', async () => {
    await upload(trainer, memberA, jpeg()).expect(403);
    await upload(reception, outsider, jpeg()).expect(404);
    await request(server()).put(`/gyms/${gymA}/members/${memberA}/photo`).expect(401);
    await request(server())
      .delete(`/gyms/${gymA}/members/${memberA}/photo`)
      .auth(trainer, { type: 'bearer' })
      .expect(403);
  });

  s3it('a member, another gym\'s reception and a bad id are refused; the owner may upload', async () => {
    await upload(memberToken, memberA, jpeg()).expect(403);
    await upload(receptionB, memberA, jpeg()).expect(403); // reception of gym B on gym A's path
    await upload(reception, memberA, jpeg(), 'me.jpg', gymB).expect(403); // gym A's reception on gym B's path
    await upload(reception, 'not-a-uuid', jpeg()).expect(400);
    await upload(owner, memberA, jpeg(64, 4)).expect(200); // the owner satisfies a reception requirement
  });

  s3it('a photo in gym B cannot be seen or removed through gym A', async () => {
    await upload(receptionB, outsider, jpeg(), 'me.jpg', gymB).expect(200);
    await request(server())
      .delete(`/gyms/${gymA}/members/${outsider}/photo`)
      .auth(reception, { type: 'bearer' })
      .expect(404);
    await request(server())
      .get(`/gyms/${gymA}/members/${outsider}`)
      .auth(reception, { type: 'bearer' })
      .expect(404);
    expect(await systemDb.select().from(memberPhotos).where(eq(memberPhotos.memberId, outsider))).toHaveLength(1);
  });

  s3it('puts the photo link on a manual check-in result, and on the members list', async () => {
    const res = await request(server())
      .post(`/gyms/${gymA}/members/${memberA}/check-ins`)
      .auth(reception, { type: 'bearer' })
      .expect(201);
    const body = res.body as CheckInResult;
    expect(body.member.photoUrl).toMatch(/^http/);
    expect((await fetchBytes(body.member.photoUrl!)).status).toBe(200);

    const list = (
      await request(server())
        .get(`/gyms/${gymA}/members`)
        .auth(reception, { type: 'bearer' })
        .expect(200)
    ).body as { userId: string; photoUrl: string | null }[];
    expect(list.find((m) => m.userId === memberA)!.photoUrl).toMatch(/^http/);
  });

  s3it('removes the photo: 204, the object is gone, the detail has none; removing again is 404', async () => {
    const url = (await detail()).photoUrl!;
    await request(server())
      .delete(`/gyms/${gymA}/members/${memberA}/photo`)
      .auth(reception, { type: 'bearer' })
      .expect(204);
    expect((await detail()).photoUrl).toBeNull();
    expect((await fetchBytes(url)).status).toBe(404);
    await request(server())
      .delete(`/gyms/${gymA}/members/${memberA}/photo`)
      .auth(reception, { type: 'bearer' })
      .expect(404);
  });

  s3it('records photo_updated and photo_removed in the history without any object key or link', async () => {
    const rows = await systemDb.select().from(auditLog).where(eq(auditLog.entityId, memberA));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('member.photo_updated');
    expect(actions).toContain('member.photo_removed');
    expect(JSON.stringify(rows.map((r) => r.data))).not.toMatch(/X-Amz|gyms\//);
  });
});
