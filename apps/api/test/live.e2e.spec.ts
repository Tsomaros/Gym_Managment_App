import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CheckInResult, LiveEvent, MembershipType } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { CheckInEvents } from '../src/checkin/checkin-events';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  checkIns,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  payments,
  users,
} from '../src/db/schema';
import { configureApp } from '../src/main';

class TestClock {
  current = new Date('2027-05-01T09:00:00Z');
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

interface Stream {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Resolves with the next parsed event, or null after `ms` without one. */
  next(ms?: number): Promise<{ event: string; data: LiveEvent } | null>;
  text(): string;
  close(): void;
}

/** Opens an SSE stream and parses what arrives. */
function openStream(port: number, path: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let buffer = '';
      let all = '';
      const events: { event: string; data: LiveEvent }[] = [];
      const waiting: ((e: { event: string; data: LiveEvent } | null) => void)[] = [];
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        all += chunk;
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) {
            const parsed = { event, data: JSON.parse(data) as LiveEvent };
            const w = waiting.shift();
            if (w) w(parsed);
            else events.push(parsed);
          }
        }
      });
      res.on('error', () => undefined);
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: () => all,
        close: () => req.destroy(),
        next: (ms = 1000) =>
          new Promise((r) => {
            const queued = events.shift();
            if (queued) return r(queued);
            const timer = setTimeout(() => {
              const at = waiting.indexOf(handler);
              if (at !== -1) waiting.splice(at, 1);
              r(null);
            }, ms);
            const handler = (e: { event: string; data: LiveEvent } | null) => {
              clearTimeout(timer);
              r(e);
            };
            waiting.push(handler);
          }),
      });
    });
    req.on('error', reject);
  });
}

describe('live check-in stream', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let port: number;
  let gymA: string;
  let gymB: string;
  let recA: string;
  let trainerA: string;
  let memberTokenA: string;
  let recB: string;
  let memberA: string;
  let memberB: string;
  const open: Stream[] = [];
  const server = () => app.getHttpServer();

  const ticket = async (gym: string, token: string): Promise<string> =>
    (
      (
        await request(server())
          .post(`/gyms/${gym}/live/tickets`)
          .auth(token, { type: 'bearer' })
          .expect(201)
      ).body as { ticket: string }
    ).ticket;
  const stream = async (gym: string, t: string): Promise<Stream> => {
    const s = await openStream(port, `/gyms/${gym}/live?ticket=${encodeURIComponent(t)}`);
    open.push(s);
    return s;
  };
  const manual = (gym: string, token: string, member: string) =>
    request(server())
      .post(`/gyms/${gym}/members/${member}/check-ins`)
      .auth(token, { type: 'bearer' });

  async function member(gym: string, owner: string, name: string): Promise<string> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${name}-${run}@x.gr`, firstName: name, lastName: 'Μέλος' })
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values({ gymId: gym, userId: u!.id, role: 'member' });
    const type = (
      await request(server())
        .post(`/gyms/${gym}/membership-types`)
        .auth(owner, { type: 'bearer' })
        .send({
          name: 'Μηνιαία',
          kind: 'time',
          durationMonths: 1,
          priceCents: 4000,
          maxFreezeDays: 0,
        })
        .expect(201)
    ).body as MembershipType;
    await request(server())
      .post(`/gyms/${gym}/members/${u!.id}/memberships`)
      .auth(owner, { type: 'bearer' })
      .send({ typeId: type.id, amountCents: 4000, method: 'cash' })
      .expect(201);
    return u!.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Live A ${run}` }, { name: `Live B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const staff = await systemDb
      .insert(users)
      .values(
        ['reca', 'trainera', 'recb', 'membera'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'Staff',
        })),
      )
      .returning({ id: users.id });
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: staff[0]!.id, role: 'owner' },
      { gymId: gymA, userId: staff[1]!.id, role: 'trainer' },
      { gymId: gymB, userId: staff[2]!.id, role: 'owner' },
      { gymId: gymA, userId: staff[3]!.id, role: 'member' },
    ]);
    const sign = (id: string) => signAccessToken({ sub: id, adm: false });
    recA = sign(staff[0]!.id);
    trainerA = sign(staff[1]!.id);
    recB = sign(staff[2]!.id);
    memberTokenA = sign(staff[3]!.id);
    memberA = await member(gymA, recA, 'giorgos');
    memberB = await member(gymB, recB, 'nikos');
  });

  afterEach(() => {
    while (open.length) open.pop()!.close();
  });

  afterAll(async () => {
    for (const id of [gymA, gymB].filter(Boolean)) {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, id));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, id));
      await systemDb.delete(payments).where(eq(payments.gymId, id));
      await systemDb.delete(memberships).where(eq(memberships.gymId, id));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, id));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, id));
      await systemDb.delete(gyms).where(eq(gyms.id, id));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it("streams a manual check-in to a reception stream within a second, with the member's name", async () => {
    const s = await stream(gymA, await ticket(gymA, recA));
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toMatch(/text\/event-stream/);
    expect(s.headers['cache-control']).toMatch(/no-cache/);
    expect(s.headers['x-accel-buffering']).toBe('no');

    const started = Date.now();
    const result = (await manual(gymA, recA, memberA).expect(201)).body as CheckInResult;
    const got = await s.next();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(got?.event).toBe('check_in');
    expect(got?.data).toMatchObject({
      type: 'check_in',
      result: { checkInId: result.checkInId, valid: true, member: { firstName: 'giorgos' } },
    });
  });

  it('streams the same event to a trainer, and a check-out as check_out', async () => {
    const s = await stream(gymA, await ticket(gymA, trainerA));
    clock.advance(10 * 60_000);
    const result = (await manual(gymA, recA, memberA).expect(201)).body as CheckInResult;
    expect((await s.next())?.event).toBe('check_in');
    await request(server())
      .post(`/gyms/${gymA}/check-ins/${result.checkInId}/check-out`)
      .auth(recA, { type: 'bearer' })
      .expect(204);
    const out = await s.next();
    expect(out).toEqual({
      event: 'check_out',
      data: { type: 'check_out', checkInId: result.checkInId },
    });
  });

  it('does not send a repeated (duplicate) check-in a second time', async () => {
    clock.advance(10 * 60_000);
    const s = await stream(gymA, await ticket(gymA, recA));
    await manual(gymA, recA, memberA).expect(201);
    expect((await s.next())?.event).toBe('check_in');
    clock.advance(10_000);
    const dup = (await manual(gymA, recA, memberA).expect(201)).body as CheckInResult;
    expect(dup.duplicate).toBe(true);
    expect(await s.next(300)).toBeNull();
  });

  it('never delivers a gym A check-in to a gym B stream', async () => {
    clock.advance(10 * 60_000);
    const a = await stream(gymA, await ticket(gymA, recA));
    const b = await stream(gymB, await ticket(gymB, recB));
    await manual(gymA, recA, memberA).expect(201);
    expect((await a.next())?.event).toBe('check_in');
    expect(await b.next(400)).toBeNull();
    // and gym B's own check-in reaches B only
    await manual(gymB, recB, memberB).expect(201);
    expect((await b.next())?.data).toMatchObject({ result: { member: { firstName: 'nikos' } } });
    expect(await a.next(300)).toBeNull();
  });

  it('accepts a ticket once: reuse, a gym B ticket on gym A, no ticket and a made-up ticket give 401', async () => {
    const t = await ticket(gymA, recA);
    const first = await stream(gymA, t);
    expect(first.status).toBe(200);
    expect((await stream(gymA, t)).status).toBe(401);

    const foreign = await ticket(gymB, recB);
    expect((await stream(gymA, foreign)).status).toBe(401);
    // the foreign ticket was not burned by the failed attempt on the wrong gym? It must still not
    // open gym A, and it is single use anyway
    expect((await openStream(port, `/gyms/${gymA}/live`)).status).toBe(401);
    expect((await stream(gymA, 'made-up')).status).toBe(401);
  });

  it('expires a ticket after 30 s', async () => {
    const t = await ticket(gymA, recA);
    clock.advance(31_000);
    expect((await stream(gymA, t)).status).toBe(401);
    const fresh = await ticket(gymA, recA);
    clock.advance(29_000);
    expect((await stream(gymA, fresh)).status).toBe(200);
  });

  it('gives tickets to reception and trainers only', async () => {
    await request(server())
      .post(`/gyms/${gymA}/live/tickets`)
      .auth(memberTokenA, { type: 'bearer' })
      .expect(403);
    await request(server()).post(`/gyms/${gymA}/live/tickets`).expect(401);
    await request(server())
      .post(`/gyms/${gymA}/live/tickets`)
      .auth(recB, { type: 'bearer' })
      .expect(403);
  });

  it('stops delivering to a stream the client closed (no listener is left behind)', async () => {
    clock.advance(10 * 60_000);
    // Writing to a closed response never throws (publish swallows it), so look at the
    // registered listeners themselves instead of waiting for an error.
    const registry = (
      app.get(CheckInEvents) as unknown as {
        listeners: Map<string, Set<unknown>>;
      }
    ).listeners;
    const count = () => registry.get(gymA)?.size ?? 0;
    await new Promise((r) => setTimeout(r, 150)); // let streams closed by earlier tests unsubscribe
    const before = count();
    const closing = await stream(gymA, await ticket(gymA, recA));
    const staying = await stream(gymA, await ticket(gymA, recA));
    expect(count()).toBe(before + 2);
    closing.close();
    for (let i = 0; i < 40 && count() > before + 1; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(count()).toBe(before + 1);

    // the other stream keeps working after the close
    clock.advance(10 * 60_000);
    await manual(gymA, recA, memberA).expect(201);
    expect((await staying.next())?.event).toBe('check_in');
    staying.close();
    for (let i = 0; i < 40 && count() > before; i++) await new Promise((r) => setTimeout(r, 25));
    expect(count()).toBe(before);
  });
});
