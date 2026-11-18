import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Exercise, MembershipType } from '@gym/shared';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { signAccessToken } from '../../src/auth/tokens';
import { Clock } from '../../src/common/clock';
import { systemDb } from '../../src/db/client';
import {
  auditLog,
  checkIns,
  exercises,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  memberTrainers,
  payments,
  plans,
  trainerCovers,
  users,
} from '../../src/db/schema';
import { seedExercises } from '../../src/exercises/seed-exercises';
import { MailService, type MailMessage } from '../../src/mail/mail.service';
import { PushTransport } from '../../src/notifications/push.service';
import { configureApp } from '../../src/main';

/** Collects emails instead of sending them; `failWith` makes every send throw. */
export class FakeMail {
  sent: MailMessage[] = [];
  failWith: Error | null = null;
  async send(msg: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(msg);
  }
}

/** Collects pushes instead of calling the browser vendors. */
export class FakePushTransport extends PushTransport {
  sent: { endpoint: string; payload: string }[] = [];
  async send(sub: { endpoint: string }, payload: string): Promise<void> {
    this.sent.push({ endpoint: sub.endpoint, payload });
  }
}

export class TestClock {
  current = new Date('2027-05-12T09:00:00Z');
  now(): Date {
    return this.current;
  }
  setDay(iso: string): void {
    this.current = new Date(`${iso}T09:00:00Z`);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** 2027-05-12 is a Wednesday; the gym is in Europe/Athens. */
export const DAY = '2027-05-12';

/**
 * Two gyms with owner, reception, trainers t (primary of m and n) and u, members m, n and a
 * stranger/outsiderTrainer in the other gym, all with real memberships. Used by the phase 4b specs.
 */
export async function setupHealthFixture(label: string) {
  const mail = new FakeMail();
  const pushTransport = new FakePushTransport();
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(PushTransport)
    .useValue(pushTransport)
    .compile();
  const app: INestApplication = configureApp(
    moduleRef.createNestApplication({ logger: ['error', 'warn'] }),
  );
  await app.init();
  const [g1, g2] = await systemDb
    .insert(gyms)
    .values([
      { name: `${label} ${run}`, timezone: 'Europe/Athens' },
      { name: `${label} other ${run}`, timezone: 'Europe/Athens' },
    ])
    .returning({ id: gyms.id });
  const gymId = g1!.id;
  const otherGymId = g2!.id;
  await seedExercises(systemDb, gymId);
  await seedExercises(systemDb, otherGymId);

  const req = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    who: string,
    gym = gymId,
  ) =>
    request(app.getHttpServer())[method](`/gyms/${gym}${path}`).auth(tok[who]!, { type: 'bearer' });

  async function person(key: string, roles: string[], gym = gymId): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${key.toLowerCase()}-${run}@x.gr`, firstName: key, lastName: 'Test' })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb
      .insert(gymRoles)
      .values(roles.map((role) => ({ gymId: gym, userId: u!.id, role }) as never));
  }
  await person('owner', ['owner']);
  await person('rec', ['reception']);
  await person('t', ['trainer']);
  await person('u', ['trainer']);
  await person('m', ['member']);
  await person('n', ['member']);
  await person('stranger', ['member'], otherGymId);
  await person('outsiderTrainer', ['trainer'], otherGymId);
  clock.setDay(DAY);

  const withTrainer = (
    await req('post', '/membership-types', 'owner')
      .send({
        name: 'Με γυμναστή',
        kind: 'time',
        durationMonths: 1,
        priceCents: 4000,
        maxFreezeDays: 0,
        includesTrainer: true,
      })
      .expect(201)
  ).body as MembershipType;
  for (const m of ['m', 'n']) {
    await req('post', `/members/${id[m]}/memberships`, 'rec')
      .send({ typeId: withTrainer.id, amountCents: 4000, method: 'cash' })
      .expect(201);
    await req('put', `/members/${id[m]}/trainer`, 'rec').send({ trainerId: id.t }).expect(200);
  }
  const list = (await req('get', '/exercises', 't').expect(200)).body as Exercise[];
  // Bench press (weight_reps), Squat, Pull-ups, Deadlift, Plank (duration): fixed by English name.
  const exIds = ['Bench press', 'Squat', 'Pull-ups', 'Deadlift', 'Plank'].map(
    (en) => list.find((e) => e.nameEn === en)!.id,
  );

  /** Deletes everything the fixture made; `extra` first removes the spec's own tables per gym. */
  async function cleanup(extra?: (gym: string) => Promise<void>): Promise<void> {
    for (const g of [gymId, otherGymId]) {
      await extra?.(g);
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, g));
      await systemDb.delete(plans).where(eq(plans.gymId, g));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, g));
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, g));
      await systemDb.delete(memberTrainers).where(eq(memberTrainers.gymId, g));
      await systemDb.delete(payments).where(eq(payments.gymId, g));
      await systemDb.delete(memberships).where(eq(memberships.gymId, g));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, g));
      await systemDb.delete(exercises).where(eq(exercises.gymId, g));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, g));
      await systemDb.delete(gyms).where(eq(gyms.id, g));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app.close();
  }

  return { app, clock, mail, pushTransport, gymId, otherGymId, id, tok, req, exIds, run, cleanup };
}

export type HealthFixture = Awaited<ReturnType<typeof setupHealthFixture>>;

/** True when something listens on the S3 endpoint (MinIO from docker compose). */
export async function s3Reachable(): Promise<boolean> {
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
