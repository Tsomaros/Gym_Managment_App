import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { MemberDetail, MembershipType, TrainerClient } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  gymRoles,
  gyms,
  memberships,
  memberTrainers,
  membershipTypes,
  payments,
  users,
} from '../src/db/schema';
import { withGym } from '../src/db/tenant';
import { configureApp } from '../src/main';
import { trainerAccess } from '../src/trainers/trainer-access';
import { TrainersService } from '../src/trainers/trainers.service';

/** Athens is UTC+3 in May 2027 (summer time). */
const at = (day: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60_000);
};

class TestClock {
  current = new Date();
  now(): Date {
    return this.current;
  }
}

describe('primary trainer assignment (gym in Europe/Athens)', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  let withTrainer: MembershipType;
  let withoutTrainer: MembershipType;
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const server = () => app.getHttpServer();

  async function person(key: string, roles: string[], gym = gymId): Promise<string> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${key.toLowerCase()}-${run}@x.gr`, firstName: key, lastName: 'Test' })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb
      .insert(gymRoles)
      .values(roles.map((role) => ({ gymId: gym, userId: u!.id, role }) as never));
    return u!.id;
  }
  const req = (method: 'get' | 'post' | 'put' | 'delete', path: string, who: string) =>
    request(server())[method](`/gyms/${gymId}${path}`).auth(tok[who]!, { type: 'bearer' });
  const sell = (member: string, type: MembershipType) =>
    req('post', `/members/${id[member]}/memberships`, 'rec')
      .send({ typeId: type.id, amountCents: 4000, method: 'cash' })
      .expect(201);
  const assign = (member: string, trainer: string) =>
    req('put', `/members/${id[member]}/trainer`, 'rec').send({ trainerId: id[trainer] });
  const clients = async (who: string): Promise<TrainerClient[]> =>
    (await req('get', '/trainer/clients', who).expect(200)).body as TrainerClient[];
  const detail = async (member: string): Promise<MemberDetail> =>
    (await req('get', `/members/${id[member]}`, 'rec').expect(200)).body as MemberDetail;
  const access = (trainer: string, member: string, day: string, hhmm = '10:00') => {
    clock.current = at(day, hhmm);
    return withGym(gymId, (tx) => trainerAccess(tx, gymId, id[trainer]!, id[member]!, day));
  };
  const newType = async (includesTrainer: boolean): Promise<MembershipType> =>
    (
      await req('post', '/membership-types', 'owner')
        .send({
          name: includesTrainer ? 'Με γυμναστή' : 'Χωρίς γυμναστή',
          kind: 'time',
          durationMonths: 1,
          priceCents: 4000,
          maxFreezeDays: 0,
          includesTrainer,
        })
        .expect(201)
    ).body as MembershipType;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
    await app.init();
    const gs = await systemDb
      .insert(gyms)
      .values([
        { name: `Trainers ${run}`, timezone: 'Europe/Athens' },
        { name: `Trainers other ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('tA', ['trainer']);
    await person('tB', ['trainer']);
    await person('outsider', ['trainer'], otherGymId);
    clock.current = at('2027-05-01', '09:00');
    withTrainer = await newType(true);
    withoutTrainer = await newType(false);
  });

  afterAll(async () => {
    for (const g of [gymId, otherGymId].filter(Boolean)) {
      await systemDb.delete(memberTrainers).where(eq(memberTrainers.gymId, g));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, g));
      await systemDb.delete(payments).where(eq(payments.gymId, g));
      await systemDb.delete(memberships).where(eq(memberships.gymId, g));
      await systemDb.delete(membershipTypes).where(eq(membershipTypes.gymId, g));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, g));
      await systemDb.delete(gyms).where(eq(gyms.id, g));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('assigns a trainer to a member with a trainer membership: primary access, client list, member detail', async () => {
    await person('m1', ['member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('m1', withTrainer);

    expect(await access('tA', 'm1', '2027-05-01')).toBeNull(); // not assigned yet
    clock.current = at('2027-05-01', '09:00');
    const res = await assign('m1', 'tA').expect(200);
    expect(res.body).toMatchObject({ userId: id.tA, firstName: 'tA', paused: false });

    expect(await access('tA', 'm1', '2027-05-01')).toBe('primary');
    expect(await access('tB', 'm1', '2027-05-01')).toBeNull();
    const list = await clients('tA');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      memberId: id.m1,
      firstName: 'm1',
      paused: false,
      membershipStatus: 'active',
      photoUrl: null,
    });
    expect((await detail('m1')).trainer).toMatchObject({ userId: id.tA, paused: false });
  });

  it('refuses a member whose memberships have no personal training: 409', async () => {
    await person('m2', ['member']);
    clock.current = at('2027-05-01', '09:00');
    const none = await assign('m2', 'tA').expect(409); // no membership at all
    expect((none.body as { message: string }).message).toBe('No membership with personal training');
    await sell('m2', withoutTrainer);
    const res = await assign('m2', 'tA').expect(409);
    expect((res.body as { message: string }).message).toBe('No membership with personal training');
    expect((await detail('m2')).trainer).toBeNull();
  });

  it('pauses the link when the trainer membership ends and resumes it on a renewal, without re-assigning', async () => {
    await person('m3', ['member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('m3', withTrainer); // 2027-05-01 .. 2027-05-31
    await assign('m3', 'tB').expect(200);
    expect(await access('tB', 'm3', '2027-05-31', '23:00')).toBe('primary');
    // Last day, still inside the membership at the gym's local time
    clock.current = at('2027-05-31', '23:00');
    expect((await clients('tB')).find((c) => c.memberId === id.m3)!.paused).toBe(false);

    // Midnight in Athens: 2027-06-01 00:30 local is still 2027-05-31 in UTC, already after the end
    clock.current = at('2027-06-01', '00:30');
    expect((await clients('tB')).find((c) => c.memberId === id.m3)!.paused).toBe(true);

    // A second, unpaused client of tB, so "paused last" has something to be ordered against
    await person('m3b', ['member']);
    clock.current = at('2027-06-02', '09:00');
    await sell('m3b', withTrainer); // 2027-06-02 .. 2027-07-01
    await assign('m3b', 'tB').expect(200);

    // After the end
    clock.current = at('2027-06-02', '10:00');
    const list = await clients('tB');
    const paused = list.find((c) => c.memberId === id.m3)!;
    expect(paused.paused).toBe(true);
    expect(paused.membershipStatus).toBe('expired');
    expect(await access('tB', 'm3', '2027-06-02')).toBeNull();
    expect((await detail('m3')).trainer).toMatchObject({ userId: id.tB, paused: true });

    // Paused client last: m3b (unpaused) must come before m3 (paused), whatever their names
    expect(list.map((c) => [c.memberId, c.paused])).toEqual([
      [id.m3b, false],
      [id.m3, true],
    ]);

    // A renewal without personal training does not resume the link
    clock.current = at('2027-06-02', '10:15');
    await sell('m3', withoutTrainer);
    expect(await access('tB', 'm3', '2027-06-02', '10:15')).toBeNull();
    expect((await clients('tB')).find((c) => c.memberId === id.m3)!.paused).toBe(true);

    // Renewal with a trainer: active again, same link
    clock.current = at('2027-06-02', '10:30');
    await sell('m3', withTrainer);
    expect(await access('tB', 'm3', '2027-06-02', '10:30')).toBe('primary');
    expect((await clients('tB')).find((c) => c.memberId === id.m3)!.paused).toBe(false);
    expect((await detail('m3')).trainer).toMatchObject({ userId: id.tB, paused: false });
    const assigned = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'trainer.assigned'), eq(auditLog.entityId, id.m3!)));
    expect(assigned).toHaveLength(1); // resumed without re-assigning
  });

  it('reassigning moves the member between trainers and records both assignments', async () => {
    await person('m4', ['member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('m4', withTrainer);
    await assign('m4', 'tA').expect(200);
    await assign('m4', 'tB').expect(200);

    expect((await clients('tA')).map((c) => c.memberId)).not.toContain(id.m4);
    expect((await clients('tB')).map((c) => c.memberId)).toContain(id.m4);
    expect(await access('tA', 'm4', '2027-05-01')).toBeNull();
    const rows = await systemDb
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.gymId, gymId),
          eq(auditLog.action, 'trainer.assigned'),
          eq(auditLog.entityId, id.m4!),
        ),
      )
      .orderBy(auditLog.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data).toMatchObject({ trainerId: id.tA, previousTrainerId: null });
    expect(rows[1]!.data).toMatchObject({ trainerId: id.tB, previousTrainerId: id.tA });
  });

  it('unassigns: 204, history, and a second unassign is 404', async () => {
    await person('m5', ['member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('m5', withTrainer);
    await assign('m5', 'tA').expect(200);
    await req('delete', `/members/${id.m5}/trainer`, 'rec').expect(204);
    expect((await detail('m5')).trainer).toBeNull();
    expect(await access('tA', 'm5', '2027-05-01')).toBeNull();
    await req('delete', `/members/${id.m5}/trainer`, 'rec').expect(404);
    const rows = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'trainer.unassigned'), eq(auditLog.entityId, id.m5!)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ trainerId: id.tA });
  });

  it('refuses another gym’s trainer, non-trainers and wrong callers', async () => {
    await person('m6', ['member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('m6', withTrainer);
    // m6 has a trainer membership, so the only possible reason for these 404s is the trainer
    for (const who of ['outsider', 'rec', 'm6']) {
      const res = await assign('m6', who).expect(404);
      expect((res.body as { message: string }).message).toBe('No such trainer');
    }
    await req('put', `/members/${id.m6}/trainer`, 'tA').send({ trainerId: id.tA }).expect(403);
    await req('get', '/trainer/clients', 'm6').expect(403);
    await req('get', '/trainer/clients', 'rec').expect(403);
    await req('put', `/members/${id.m6}/trainer`, 'rec').send({ trainerId: 'nope' }).expect(400);
    // a staff member is not a member of the gym
    const notMember = await req('put', `/members/${id.tB}/trainer`, 'rec')
      .send({ trainerId: id.tA })
      .expect(404);
    expect((notMember.body as { message: string }).message).toBe('Not a member of this gym');
    expect((await detail('m6')).trainer).toBeNull();
    expect(await clients('tA').then((l) => l.map((c) => c.memberId))).not.toContain(id.m6);
  });

  it('removing a trainer role clears their clients, one history row each', async () => {
    await person('t9', ['trainer']);
    await person('m7', ['member']);
    await person('m8', ['member']);
    await person('m9', ['member']);
    clock.current = at('2027-05-01', '09:00');
    for (const m of ['m7', 'm8']) {
      await sell(m, withTrainer);
      await assign(m, 't9').expect(200);
    }
    await sell('m9', withTrainer); // belongs to another trainer: must survive
    await assign('m9', 'tA').expect(200);
    await req('delete', `/staff/${id.t9}/roles/trainer`, 'owner').expect(204);
    expect((await detail('m7')).trainer).toBeNull();
    expect((await detail('m8')).trainer).toBeNull();
    expect((await detail('m9')).trainer).toMatchObject({ userId: id.tA });
    const rows = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.gymId, gymId), eq(auditLog.action, 'trainer.unassigned')));
    const mine = rows.filter((r) => [id.m7, id.m8].includes(r.entityId!));
    expect(mine).toHaveLength(2);
    for (const r of mine) {
      expect(r.data).toMatchObject({ trainerId: id.t9, reason: 'role_removed' });
    }
  });

  it('waits for the per-trainer lock, so assigning cannot race with removing the trainer role', async () => {
    await person('tLock', ['trainer']);
    await person('mLock', ['member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('mLock', withTrainer);

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const locked = new Promise<void>((ready) => {
      void systemDb.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'trainer:' + id.tLock}))`);
        ready();
        await held;
      });
    });
    await locked;

    let finished = false;
    try {
      const pending = app
        .get(TrainersService)
        .assign(gymId, id.owner!, id.mLock!, id.tLock!)
        .then(() => (finished = true));
      await new Promise((r) => setTimeout(r, 500));
      expect(finished).toBe(false); // still waiting for the lock
      release();
      await pending;
    } finally {
      release(); // never leave the lock held if an assertion fails
    }
    expect(finished).toBe(true);
    expect((await detail('mLock')).trainer).toMatchObject({ userId: id.tLock });
  });

  it('refuses a trainer who is also a member as their own primary trainer', async () => {
    await person('tself', ['trainer', 'member']);
    clock.current = at('2027-05-01', '09:00');
    await sell('tself', withTrainer);
    const res = await assign('tself', 'tself').expect(400);
    expect((res.body as { message: string }).message).toBe('A trainer cannot train themselves');
    expect((await detail('tself')).trainer).toBeNull();
  });
});
