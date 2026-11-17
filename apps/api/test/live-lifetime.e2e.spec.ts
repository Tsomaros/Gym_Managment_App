import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { CheckInEvents } from '../src/checkin/checkin-events';
import { LIVE_STREAM_MAX_MS } from '../src/checkin/live.controller';
import { systemDb } from '../src/db/client';
import { gymRoles, gyms, users } from '../src/db/schema';
import { configureApp } from '../src/main';

/** A stream lives only so long: the client then asks for a new ticket, which re-checks its role. */
describe('live stream lifetime', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication;
  let port: number;
  let gymId: string;
  let reception: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LIVE_STREAM_MAX_MS)
      .useValue(400)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Lifetime ${run}` })
      .returning({ id: gyms.id });
    gymId = g!.id;
    const [u] = await systemDb
      .insert(users)
      .values({ email: `rec-${run}@x.gr`, firstName: 'rec', lastName: 'Test' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId, userId: u!.id, role: 'reception' });
    reception = signAccessToken({ sub: u!.id, adm: false });
  });

  afterAll(async () => {
    if (gymId) {
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
      await systemDb.delete(gyms).where(eq(gyms.id, gymId));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  const ticket = async (): Promise<string> =>
    (
      (
        await request(app.getHttpServer())
          .post(`/gyms/${gymId}/live/tickets`)
          .auth(reception, { type: 'bearer' })
          .expect(201)
      ).body as { ticket: string }
    ).ticket;

  /** Opens a stream; `ended` resolves when the server ends it. */
  const open = (t: string) =>
    new Promise<{ status: number; ended: Promise<number>; close: () => void }>((resolve) => {
      const started = Date.now();
      const req = http.get(
        { host: '127.0.0.1', port, path: `/gyms/${gymId}/live?ticket=${t}` },
        (res) => {
          res.resume();
          resolve({
            status: res.statusCode ?? 0,
            ended: new Promise((done) => res.on('end', () => done(Date.now() - started))),
            close: () => req.destroy(),
          });
        },
      );
    });

  it('ends a stream after its maximum age, frees its listener, and lets the client come back with a new ticket', async () => {
    const events = app.get(CheckInEvents);
    const first = await open(await ticket());
    expect(first.status).toBe(200);
    expect(events.listenerCount(gymId)).toBe(1);

    const lived = await first.ended;
    expect(lived).toBeGreaterThanOrEqual(300);
    expect(lived).toBeLessThan(3000);
    for (let i = 0; i < 40 && events.listenerCount(gymId) > 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(events.listenerCount(gymId)).toBe(0);

    const second = await open(await ticket());
    expect(second.status).toBe(200);
    second.close();
  });

  it('refuses a new ticket once the role is gone, so a removed receptionist cannot stay connected', async () => {
    await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
    await request(app.getHttpServer())
      .post(`/gyms/${gymId}/live/tickets`)
      .auth(reception, { type: 'bearer' })
      .expect(403);
  });
});
