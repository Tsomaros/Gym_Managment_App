import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CheckInResult, MembershipType, TrainerClient } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import {
  auditLog,
  checkIns,
  gymRoles,
  gyms,
  memberships,
  membershipTypes,
  memberTrainers,
  payments,
  shifts,
  trainerCovers,
  users,
} from '../src/db/schema';
import { withGym } from '../src/db/tenant';
import { todayIn } from '../src/memberships/dates';
import { configureApp } from '../src/main';
import { CoversService } from '../src/trainers/covers.service';
import { trainerAccess } from '../src/trainers/trainer-access';

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

// 2027-05-12 is a Wednesday.
describe('same-day cover trainers (gym in Europe/Athens)', () => {
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
  const onShift = (who: string, day: string, from: string, to: string) =>
    systemDb
      .insert(shifts)
      .values({ gymId, staffId: id[who]!, date: day, startsAt: from, endsAt: to });
  const req = (method: 'get' | 'post' | 'put' | 'delete', path: string, who: string) =>
    request(server())[method](`/gyms/${gymId}${path}`).auth(tok[who]!, { type: 'bearer' });
  const sell = (member: string, type: MembershipType) =>
    req('post', `/members/${id[member]}/memberships`, 'rec')
      .send({ typeId: type.id, amountCents: 4000, method: 'cash' })
      .expect(201);
  const cover = (member: string, trainer: string) =>
    req('put', `/members/${id[member]}/cover`, 'rec').send({ trainerId: id[trainer] });
  const clients = async (who: string): Promise<TrainerClient[]> =>
    (await req('get', '/trainer/clients', who).expect(200)).body as TrainerClient[];
  const checkIn = async (member: string): Promise<CheckInResult> =>
    (await req('post', `/members/${id[member]}/check-ins`, 'rec').expect(201))
      .body as CheckInResult;
  const accessNow = (trainer: string, member: string) =>
    withGym(gymId, (tx) =>
      trainerAccess(tx, gymId, id[trainer]!, id[member]!, todayIn('Europe/Athens', clock.now())),
    );
  const coverRows = (member: string) =>
    systemDb.select().from(trainerCovers).where(eq(trainerCovers.memberId, id[member]!));

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
        { name: `Covers ${run}`, timezone: 'Europe/Athens' },
        { name: `Covers other ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('tprim', ['trainer']);
    await person('uCover', ['trainer']);
    await person('vOff', ['trainer']);
    await person('outsider', ['trainer'], otherGymId);
    clock.current = at('2027-05-12', '09:00');
    const mkType = async (includesTrainer: boolean): Promise<MembershipType> =>
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
    withTrainer = await mkType(true);
    withoutTrainer = await mkType(false);
    // uCover works 08:00–18:00 on the 12th; tprim and vOff do not work that day.
    await onShift('uCover', '2027-05-12', '08:00', '18:00');
  });

  afterAll(async () => {
    for (const g of [gymId, otherGymId].filter(Boolean)) {
      await systemDb.delete(checkIns).where(eq(checkIns.gymId, g));
      await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, g));
      await systemDb.delete(memberTrainers).where(eq(memberTrainers.gymId, g));
      await systemDb.delete(shifts).where(eq(shifts.gymId, g));
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

  it('gives cover access until the end of the gym day: 23:59 yes, 00:00 the next day no', async () => {
    await person('m1', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m1', withTrainer);
    clock.current = at('2027-05-12', '10:00');
    const res = await cover('m1', 'uCover').expect(200);
    expect(res.body).toMatchObject({ trainerId: id.uCover, date: '2027-05-12' });

    expect(await accessNow('uCover', 'm1')).toBe('cover');
    clock.current = at('2027-05-12', '23:59');
    expect(await accessNow('uCover', 'm1')).toBe('cover');
    expect((await clients('uCover')).map((c) => c.memberId)).toContain(id.m1);
    clock.current = at('2027-05-13', '00:00');
    expect(await accessNow('uCover', 'm1')).toBeNull();
    expect((await clients('uCover')).map((c) => c.memberId)).not.toContain(id.m1);
    expect(await accessNow('tprim', 'm1')).toBeNull();
  });

  it("lists today's cover in the trainer's client list with cover: true", async () => {
    await person('m2', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m2', withTrainer);
    clock.current = at('2027-05-12', '10:00');
    await cover('m2', 'uCover').expect(200);
    const row = (await clients('uCover')).find((c) => c.memberId === id.m2)!;
    expect(row).toMatchObject({ cover: true, paused: false, firstName: 'm2' });
    expect(row.membershipStatus).toBe('active');

    // a primary client of the same trainer carries no cover flag
    await person('m2p', ['member']);
    await sell('m2p', withTrainer);
    await req('put', `/members/${id.m2p}/trainer`, 'rec')
      .send({ trainerId: id.uCover })
      .expect(200);
    const list = await clients('uCover');
    const primary = list.find((c) => c.memberId === id.m2p)!;
    expect(primary.cover).toBeFalsy();
    expect(list.find((c) => c.memberId === id.m2)!.cover).toBe(true);
    // each member is listed once
    expect(list.filter((c) => c.memberId === id.m2)).toHaveLength(1);
  });

  it('refuses a trainer who is not on duty (409), the primary trainer (400) and replaces a second cover', async () => {
    await person('m3', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m3', withTrainer);
    clock.current = at('2027-05-12', '10:00');
    const off = await cover('m3', 'vOff').expect(409);
    expect((off.body as { message: string }).message).toBe('Trainer not on duty');
    clock.current = at('2027-05-12', '18:00'); // the shift is over: end is exclusive
    await cover('m3', 'uCover').expect(409);

    clock.current = at('2027-05-12', '10:00');
    await onShift('tprim', '2027-05-12', '08:00', '18:00');
    await req('put', `/members/${id.m3}/trainer`, 'rec').send({ trainerId: id.tprim }).expect(200);
    await cover('m3', 'tprim').expect(400); // own primary trainer, even when on duty
    expect(await coverRows('m3')).toEqual([]);

    await cover('m3', 'uCover').expect(200);
    await onShift('vOff', '2027-05-12', '09:00', '12:00');
    await cover('m3', 'vOff').expect(200);
    const rows = await coverRows('m3');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trainerId).toBe(id.vOff);
    expect((await clients('uCover')).map((c) => c.memberId)).not.toContain(id.m3);
  });

  it('on duty is start-inclusive and end-exclusive for a cover', async () => {
    await person('vEdge', ['trainer']);
    await onShift('vEdge', '2027-05-12', '09:00', '12:00');
    await person('mEdge', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('mEdge', withTrainer);
    clock.current = at('2027-05-12', '08:59'); // one minute before the start
    await cover('mEdge', 'vEdge').expect(409);
    clock.current = at('2027-05-12', '09:00'); // the start minute counts
    await cover('mEdge', 'vEdge').expect(200);
    await req('delete', `/members/${id.mEdge}/cover`, 'rec').expect(204);
    clock.current = at('2027-05-12', '11:59'); // last minute
    await cover('mEdge', 'vEdge').expect(200);
    await req('delete', `/members/${id.mEdge}/cover`, 'rec').expect(204);
    clock.current = at('2027-05-12', '12:00'); // the end minute does not
    await cover('mEdge', 'vEdge').expect(409);
    expect(await coverRows('mEdge')).toEqual([]);
  });

  it('needs no trainer membership for a cover, and removes it again', async () => {
    await person('m4', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m4', withoutTrainer);
    clock.current = at('2027-05-12', '10:00');
    await cover('m4', 'uCover').expect(200);
    expect(await accessNow('uCover', 'm4')).toBe('cover');
    await req('delete', `/members/${id.m4}/cover`, 'rec').expect(204);
    expect(await accessNow('uCover', 'm4')).toBeNull();
    await req('delete', `/members/${id.m4}/cover`, 'rec').expect(404);
    const actions = await systemDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.gymId, gymId), eq(auditLog.entityId, id.m4!)));
    expect(actions.map((a) => a.action).sort()).toEqual(['cover.assigned', 'cover.removed']);
  });

  it('shows the primary trainer, whether they are on duty, and the cover in the check-in result', async () => {
    await person('vPrim', ['trainer']);
    await onShift('vPrim', '2027-05-12', '09:00', '12:00'); // own shift: no reliance on other tests
    await person('m5', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m5', withTrainer);
    await req('put', `/members/${id.m5}/trainer`, 'rec').send({ trainerId: id.vPrim }).expect(200);

    clock.current = at('2027-05-12', '08:30'); // vPrim's shift (09:00) has not begun
    const first = await checkIn('m5');
    expect(first.trainer).toMatchObject({ userId: id.vPrim, firstName: 'vPrim', onDuty: false });
    expect(first.cover).toBeNull();

    clock.current = at('2027-05-12', '10:00');
    await cover('m5', 'uCover').expect(200);
    const second = await checkIn('m5'); // a duplicate within the window repeats the first check-in
    expect(second.trainer).toMatchObject({ userId: id.vPrim, onDuty: true });
    expect(second.cover).toEqual({ trainerId: id.uCover, firstName: 'uCover' });

    // a member without a primary trainer: nothing to show
    await person('m6', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m6', withTrainer);
    clock.current = at('2027-05-12', '10:00');
    const bare = await checkIn('m6');
    expect(bare.trainer).toBeNull();
    expect(bare.cover).toBeNull();
  });

  it('removing a trainer role deletes their covers from today on', async () => {
    await person('wGone', ['trainer']);
    await onShift('wGone', '2027-05-12', '08:00', '18:00');
    await person('m7', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m7', withTrainer);
    clock.current = at('2027-05-12', '10:00');
    await cover('m7', 'wGone').expect(200);
    // a cover of yesterday stays as history; one of tomorrow goes too
    await systemDb.insert(trainerCovers).values([
      { gymId, memberId: id.m7!, trainerId: id.wGone!, date: '2027-05-11' },
      { gymId, memberId: id.m7!, trainerId: id.wGone!, date: '2027-05-13' },
    ]);
    // another trainer's cover of the same day must survive
    await person('m7b', ['member']);
    await sell('m7b', withTrainer);
    await cover('m7b', 'uCover').expect(200);

    await req('delete', `/staff/${id.wGone}/roles/trainer`, 'owner').expect(204);
    const rows = await coverRows('m7');
    expect(rows.map((r) => r.date)).toEqual(['2027-05-11']);
    expect((await coverRows('m7b')).map((r) => r.trainerId)).toEqual([id.uCover]);
    const audit = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id.m7!), eq(auditLog.action, 'cover.removed')));
    expect(audit).toHaveLength(2);
    for (const a of audit)
      expect(a.data).toMatchObject({ trainerId: id.wGone, reason: 'role_removed' });
  });

  it('waits for the per-trainer lock, so a cover cannot race with removing the trainer role', async () => {
    await person('wLock', ['trainer']);
    await onShift('wLock', '2027-05-12', '08:00', '18:00');
    await person('mCLock', ['member']);
    clock.current = at('2027-05-12', '10:00');

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const locked = new Promise<void>((ready) => {
      void systemDb.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'trainer:' + id.wLock}))`);
        ready();
        await held;
      });
    });
    await locked;
    let finished = false;
    try {
      const pending = app
        .get(CoversService)
        .assign(gymId, id.owner!, id.mCLock!, id.wLock!)
        .then(() => (finished = true));
      await new Promise((r) => setTimeout(r, 500));
      expect(finished).toBe(false); // still waiting for the lock
      release();
      await pending;
    } finally {
      release();
    }
    expect(finished).toBe(true);
    expect((await coverRows('mCLock')).map((r) => r.trainerId)).toEqual([id.wLock]);
  });

  it('refuses another gym, non-trainers and wrong callers', async () => {
    await person('m8', ['member']);
    clock.current = at('2027-05-12', '10:00');
    await cover('m8', 'outsider').expect(404);
    await cover('m8', 'rec').expect(404);
    await req('put', `/members/${id.m8}/cover`, 'uCover')
      .send({ trainerId: id.uCover })
      .expect(403);
    await req('delete', `/members/${id.m8}/cover`, 'uCover').expect(403);
    // not a member of this gym
    await req('put', `/members/${id.tprim}/cover`, 'rec')
      .send({ trainerId: id.uCover })
      .expect(404);
    expect(await coverRows('m8')).toEqual([]);
  });

  it('lists a member once when their cover trainer later becomes their primary trainer', async () => {
    await person('xDup', ['trainer']);
    await onShift('xDup', '2027-05-12', '08:00', '18:00');
    await person('m9', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m9', withTrainer);
    clock.current = at('2027-05-12', '10:00');
    await cover('m9', 'xDup').expect(200);
    await req('put', `/members/${id.m9}/trainer`, 'rec').send({ trainerId: id.xDup }).expect(200);
    const rows = (await clients('xDup')).filter((c) => c.memberId === id.m9);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cover).toBeUndefined();
    expect(await accessNow('xDup', 'm9')).toBe('primary');
  });

  it('keeps the cover for a member whose primary link is paused', async () => {
    await person('yPaused', ['trainer']);
    await onShift('yPaused', '2027-05-12', '08:00', '18:00');
    await person('m10', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m10', withTrainer);
    await req('put', `/members/${id.m10}/trainer`, 'rec')
      .send({ trainerId: id.yPaused })
      .expect(200);
    // move the trainer membership into the past (it ended 2027-04-30), so the link is paused
    await systemDb
      .update(memberships)
      .set({ startsOn: '2027-04-01', baseEndsOn: '2027-04-30', endsOn: '2027-04-30' })
      .where(eq(memberships.memberId, id.m10!));
    clock.current = at('2027-05-12', '10:00');
    expect(await accessNow('yPaused', 'm10')).toBeNull();
    const [row] = (await clients('yPaused')).filter((c) => c.memberId === id.m10);
    expect(row).toMatchObject({ paused: true });
    expect(row!.cover).toBeUndefined();
    // a cover for another trainer is unaffected; the paused primary trainer needs none
    await cover('m10', 'uCover').expect(200);
    expect(await accessNow('uCover', 'm10')).toBe('cover');
  });

  it('hides a paused primary trainer in the check-in result', async () => {
    await person('zPaused', ['trainer']);
    await person('m11', ['member']);
    clock.current = at('2027-05-12', '09:00');
    await sell('m11', withTrainer);
    await req('put', `/members/${id.m11}/trainer`, 'rec')
      .send({ trainerId: id.zPaused })
      .expect(200);
    await systemDb
      .update(memberships)
      .set({ startsOn: '2027-04-01', baseEndsOn: '2027-04-30', endsOn: '2027-04-30' })
      .where(eq(memberships.memberId, id.m11!));
    await sell('m11', withoutTrainer); // a running membership, but without personal training
    clock.current = at('2027-05-12', '10:00');
    const result = await checkIn('m11');
    expect(result.valid).toBe(true);
    expect(result.trainer).toBeNull();
  });

  it('refuses a trainer covering themselves', async () => {
    await person('tSelf', ['trainer', 'member']);
    await onShift('tSelf', '2027-05-12', '08:00', '18:00');
    clock.current = at('2027-05-12', '10:00');
    await cover('tSelf', 'tSelf').expect(400);
    expect(await coverRows('tSelf')).toEqual([]);
  });
});
