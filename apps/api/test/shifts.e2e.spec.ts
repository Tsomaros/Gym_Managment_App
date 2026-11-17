import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExpandedShift, OnDutyPerson, ScheduleResponse } from '@gym/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/auth/tokens';
import { Clock } from '../src/common/clock';
import { systemDb } from '../src/db/client';
import { auditLog, gymRoles, gyms, shiftSeries, shifts, users } from '../src/db/schema';
import { configureApp } from '../src/main';

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

// 2027-05-03 is a Monday.
describe('shifts: series, overrides, schedules, on duty now (gym in Europe/Athens)', () => {
  const run = randomUUID().slice(0, 8);
  const clock = new TestClock();
  let app: INestApplication;
  let gymId: string;
  let otherGymId: string;
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const server = () => app.getHttpServer();

  async function person(key: string, roles: string[], gym = gymId): Promise<void> {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `${key}-${run}@x.gr`, firstName: key, lastName: 'Staff' })
      .returning({ id: users.id });
    id[key] = u!.id;
    tok[key] = signAccessToken({ sub: u!.id, adm: false });
    await systemDb
      .insert(gymRoles)
      .values(roles.map((role) => ({ gymId: gym, userId: u!.id, role }) as never));
  }
  const req = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, who: string) =>
    request(server())[method](`/gyms/${gymId}${path}`).auth(tok[who]!, { type: 'bearer' });
  const newSeries = (who: string, body: Record<string, unknown>) =>
    req('post', '/shift-series', who).send({
      weekday: 1,
      startsAt: '06:00',
      endsAt: '14:00',
      validFrom: '2027-05-03',
      ...body,
    });
  const schedule = async (from: string, to: string, who = 'owner'): Promise<ScheduleResponse> =>
    (await req('get', `/schedule?from=${from}&to=${to}`, who).expect(200)).body as ScheduleResponse;
  const mine = async (who: string, from: string, to: string): Promise<ExpandedShift[]> =>
    (await req('get', `/me/schedule?from=${from}&to=${to}`, who).expect(200))
      .body as ExpandedShift[];
  const onDuty = async (who = 'rec'): Promise<OnDutyPerson[]> =>
    (await req('get', '/on-duty', who).expect(200)).body as OnDutyPerson[];
  const brief = (xs: ExpandedShift[]) => xs.map((x) => `${x.date} ${x.startsAt}-${x.endsAt}`);

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
        { name: `Shifts ${run}`, timezone: 'Europe/Athens' },
        { name: `Shifts other ${run}`, timezone: 'Europe/Athens' },
      ])
      .returning({ id: gyms.id });
    gymId = gs[0]!.id;
    otherGymId = gs[1]!.id;
    await person('owner', ['owner']);
    await person('rec', ['reception']);
    await person('memberonly', ['member']);
    await person('outsider', ['trainer'], otherGymId);
    clock.current = at('2027-05-03', '10:00');
  });

  afterAll(async () => {
    for (const g of [gymId, otherGymId].filter(Boolean)) {
      await systemDb.delete(shifts).where(eq(shifts.gymId, g));
      await systemDb.delete(shiftSeries).where(eq(shiftSeries.gymId, g));
      await systemDb.delete(auditLog).where(eq(auditLog.gymId, g));
      await systemDb.delete(gymRoles).where(eq(gymRoles.gymId, g));
      await systemDb.delete(gyms).where(eq(gyms.id, g));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@x.gr`}`);
    await app?.close();
  });

  it('is on duty at 13:59 and not at 14:00 for a 06:00–14:00 Monday shift', async () => {
    await person('t1', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    await newSeries('owner', { staffId: id.t1 }).expect(201);

    clock.current = at('2027-05-03', '05:59');
    expect((await onDuty()).map((p) => p.userId)).not.toContain(id.t1);
    clock.current = at('2027-05-03', '06:00');
    expect((await onDuty()).map((p) => p.userId)).toContain(id.t1);
    clock.current = at('2027-05-03', '13:59');
    const now = (await onDuty('t1')).find((p) => p.userId === id.t1);
    expect(now).toMatchObject({ until: '14:00', firstName: 't1', roles: ['trainer'] });
    clock.current = at('2027-05-03', '14:00');
    expect((await onDuty()).map((p) => p.userId)).not.toContain(id.t1);
    // Tuesday: not on duty at all
    clock.current = at('2027-05-04', '10:00');
    expect((await onDuty()).map((p) => p.userId)).not.toContain(id.t1);
  });

  it('edits a weekly shift "from next week": this week keeps 06:00, next week shows 08:00', async () => {
    await person('t2', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    const created = await newSeries('owner', { staffId: id.t2 }).expect(201);
    const seriesId = (created.body as { id: string }).id;

    await req('post', `/shift-series/${seriesId}/end`, 'owner')
      .send({ lastDate: '2027-05-09' })
      .expect(204);
    await newSeries('owner', {
      staffId: id.t2,
      startsAt: '08:00',
      endsAt: '16:00',
      validFrom: '2027-05-10',
    }).expect(201);

    const shiftsList = (await schedule('2027-05-03', '2027-05-16')).shifts.filter(
      (s) => s.staffId === id.t2,
    );
    expect(brief(shiftsList)).toEqual(['2027-05-03 06:00-14:00', '2027-05-10 08:00-16:00']);
  });

  it('cancels one occurrence and brings it back with new times', async () => {
    await person('t3', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    const seriesId = (
      (await newSeries('owner', { staffId: id.t3 }).expect(201)).body as { id: string }
    ).id;

    await req('put', `/shift-series/${seriesId}/occurrences/2027-05-10`, 'owner')
      .send({ cancelled: true })
      .expect(200);
    expect(brief(await mine('t3', '2027-05-03', '2027-05-16'))).toEqual(['2027-05-03 06:00-14:00']);

    await req('put', `/shift-series/${seriesId}/occurrences/2027-05-10`, 'owner')
      .send({ startsAt: '10:00', endsAt: '18:00', note: 'later' })
      .expect(200);
    const back = await mine('t3', '2027-05-03', '2027-05-16');
    expect(brief(back)).toEqual(['2027-05-03 06:00-14:00', '2027-05-10 10:00-18:00']);
    expect(back[1]).toMatchObject({ note: 'later', seriesId });
    expect(back[1]!.shiftId).not.toBeNull();

    // an override on a date the series does not run (a Tuesday) is refused
    await req('put', `/shift-series/${seriesId}/occurrences/2027-05-11`, 'owner')
      .send({ cancelled: true })
      .expect(400);
  });

  it('adds, changes and deletes a one-off shift', async () => {
    await person('t4', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    const one = await req('post', '/shifts', 'owner')
      .send({ staffId: id.t4, date: '2027-05-05', startsAt: '09:00', endsAt: '12:00' })
      .expect(201);
    const shiftId = (one.body as { id: string }).id;
    expect(brief(await mine('t4', '2027-05-01', '2027-05-10'))).toEqual(['2027-05-05 09:00-12:00']);
    await req('patch', `/shifts/${shiftId}`, 'owner').send({ endsAt: '13:00' }).expect(200);
    expect(brief(await mine('t4', '2027-05-01', '2027-05-10'))).toEqual(['2027-05-05 09:00-13:00']);
    await req('patch', `/shifts/${shiftId}`, 'owner').send({ endsAt: '08:00' }).expect(400);
    await req('delete', `/shifts/${shiftId}`, 'owner').expect(204);
    expect(await mine('t4', '2027-05-01', '2027-05-10')).toEqual([]);
    await req('delete', `/shifts/${shiftId}`, 'owner').expect(404);
  });

  it('refuses past dates, a series from yesterday, long ranges and ends before starts', async () => {
    await person('t5', ['trainer']);
    clock.current = at('2027-05-10', '10:00'); // Monday
    await req('post', '/shifts', 'owner')
      .send({ staffId: id.t5, date: '2027-05-09', startsAt: '09:00', endsAt: '12:00' })
      .expect(409);
    await newSeries('owner', { staffId: id.t5, validFrom: '2027-05-09', weekday: 7 }).expect(400);
    // validFrom is today here, so only the times can be the reason for the 400
    const today = { validFrom: '2027-05-10' };
    await newSeries('owner', {
      staffId: id.t5,
      ...today,
      startsAt: '14:00',
      endsAt: '06:00',
    }).expect(400);
    await newSeries('owner', {
      staffId: id.t5,
      ...today,
      startsAt: '14:00',
      endsAt: '14:00',
    }).expect(400);
    await newSeries('owner', { staffId: id.t5, ...today, startsAt: '14:07' }).expect(400);
    // control: valid times with the same validFrom are accepted (14:00-16:00 does not touch 06:00-14:00 below)
    await newSeries('owner', {
      staffId: id.t5,
      ...today,
      startsAt: '14:00',
      endsAt: '16:00',
    }).expect(201);
    await req('get', '/schedule?from=2027-05-01&to=2027-07-02', 'owner').expect(400); // 63 days
    await req('get', '/schedule?from=2027-05-01&to=2027-07-01', 'owner').expect(200); // 62 days
    await req('get', '/schedule?from=2027-05-10&to=2027-05-01', 'owner').expect(400);

    // an occurrence override and a one-off edit in the past are read-only too
    const seriesId = (
      (await newSeries('owner', { staffId: id.t5, validFrom: '2027-05-10' }).expect(201)).body as {
        id: string;
      }
    ).id;
    clock.current = at('2027-05-11', '10:00');
    await req('put', `/shift-series/${seriesId}/occurrences/2027-05-10`, 'owner')
      .send({ cancelled: true })
      .expect(409);
    // a one-off of yesterday (seeded: the API refuses the past) cannot be edited or deleted
    const [pastOne] = await systemDb
      .insert(shifts)
      .values({
        gymId,
        staffId: id.t5!,
        date: '2027-05-10',
        startsAt: '09:00',
        endsAt: '12:00',
      })
      .returning({ id: shifts.id });
    await req('patch', `/shifts/${pastOne!.id}`, 'owner').send({ endsAt: '13:00' }).expect(409);
    await req('delete', `/shifts/${pastOne!.id}`, 'owner').expect(409);
    // Ending a series before yesterday is refused, ending it yesterday is fine. The series is
    // seeded to start long before (validFrom 05-03), so "before it starts" cannot be the reason.
    const [running] = await systemDb
      .insert(shiftSeries)
      .values({
        gymId,
        staffId: id.t5!,
        weekday: 2,
        startsAt: '06:00',
        endsAt: '14:00',
        validFrom: '2027-05-04',
      })
      .returning({ id: shiftSeries.id });
    await req('post', `/shift-series/${running!.id}/end`, 'owner')
      .send({ lastDate: '2027-05-09' })
      .expect(400);
    await req('post', `/shift-series/${running!.id}/end`, 'owner')
      .send({ lastDate: '2027-05-10' })
      .expect(204);
    // ending before it starts, and extending an ended series, are refused
    await req('post', `/shift-series/${seriesId}/end`, 'owner')
      .send({ lastDate: '2027-05-10' })
      .expect(204);
    await req('post', `/shift-series/${seriesId}/end`, 'owner')
      .send({ lastDate: '2027-05-17' })
      .expect(400);
  });

  it('refuses overlapping weekly shifts of one person but allows split shifts and other weekdays', async () => {
    await person('t10', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    await newSeries('owner', { staffId: id.t10 }).expect(201); // Mon 06:00-14:00
    await newSeries('owner', { staffId: id.t10, startsAt: '13:00', endsAt: '15:00' }).expect(409);
    await newSeries('owner', { staffId: id.t10, startsAt: '07:00', endsAt: '08:00' }).expect(409);
    // touching ends are not an overlap, and another weekday is free
    await newSeries('owner', { staffId: id.t10, startsAt: '14:00', endsAt: '18:00' }).expect(201);
    await newSeries('owner', { staffId: id.t10, weekday: 2, startsAt: '07:00' }).expect(201);
    // the first series is open-ended, so a later start still overlaps it
    await newSeries('owner', { staffId: id.t10, validFrom: '2027-05-10' }).expect(409);
    // the same hours for another person are fine
    await person('t11', ['trainer']);
    await newSeries('owner', { staffId: id.t11 }).expect(201);
  });

  it('lets reception edit shifts only once the owner allows it', async () => {
    await person('t6', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    await newSeries('rec', { staffId: id.t6 }).expect(403);
    // every write route is closed to reception, and to a trainer whatever the switch says
    const oneOff = { staffId: id.t6, date: '2027-05-05', startsAt: '09:00', endsAt: '12:00' };
    const anyId = randomUUID();
    await req('post', '/shifts', 'rec').send(oneOff).expect(403);
    await req('patch', `/shifts/${anyId}`, 'rec').send({ endsAt: '13:00' }).expect(403);
    await req('delete', `/shifts/${anyId}`, 'rec').expect(403);
    await req('post', `/shift-series/${anyId}/end`, 'rec')
      .send({ lastDate: '2027-05-09' })
      .expect(403);
    await req('put', `/shift-series/${anyId}/occurrences/2027-05-10`, 'rec')
      .send({ cancelled: true })
      .expect(403);
    await req('post', '/shifts', 't6').send(oneOff).expect(403);
    await req('patch', '/settings', 'rec').send({ receptionCanEditShifts: true }).expect(403);
    const res = await req('patch', '/settings', 'owner')
      .send({ receptionCanEditShifts: true })
      .expect(200);
    expect(res.body).toMatchObject({ receptionCanEditShifts: true, autoCheckoutMinutes: 120 });
    await newSeries('rec', { staffId: id.t6 }).expect(201);
    await req('post', '/shifts', 'rec').send(oneOff).expect(201);
    await req('post', '/shifts', 't6').send(oneOff).expect(403);
    // turning it off again closes the door
    await req('patch', '/settings', 'owner').send({ receptionCanEditShifts: false }).expect(200);
    await newSeries('rec', { staffId: id.t6 }).expect(403);
  });

  it('shows a trainer only their own shifts; the full schedule needs reception', async () => {
    await person('t7', ['trainer']);
    await person('t8', ['trainer']);
    clock.current = at('2027-05-03', '10:00');
    await newSeries('owner', { staffId: id.t7, startsAt: '07:00' }).expect(201);
    await newSeries('owner', { staffId: id.t8, startsAt: '09:00' }).expect(201);
    const own = await mine('t7', '2027-05-03', '2027-05-03');
    expect(own.map((s) => s.staffId)).toEqual([id.t7]);
    await req('get', '/schedule?from=2027-05-03&to=2027-05-03', 't7').expect(403);
    await req('get', '/me/schedule?from=2027-05-03&to=2027-05-03', 'memberonly').expect(403);

    const all = await schedule('2027-05-03', '2027-05-03', 'rec');
    expect(all.shifts.filter((s) => [id.t7, id.t8].includes(s.staffId))).toHaveLength(2);
    expect(all.staff.find((s) => s.userId === id.t7)).toMatchObject({
      firstName: 't7',
      roles: ['trainer'],
    });
    expect(all.staff.map((s) => s.userId)).not.toContain(id.memberonly);
  });

  it('refuses staff from another gym or without a staff role, and keeps gyms apart', async () => {
    clock.current = at('2027-05-03', '10:00');
    await newSeries('owner', { staffId: id.outsider }).expect(404);
    await newSeries('owner', { staffId: id.memberonly }).expect(404);
    await req('post', '/shifts', 'owner')
      .send({ staffId: id.outsider, date: '2027-05-05', startsAt: '09:00', endsAt: '12:00' })
      .expect(404);

    // a series and a one-off of gym B stay invisible and untouchable from gym A
    const [foreign] = await systemDb
      .insert(shiftSeries)
      .values({
        gymId: otherGymId,
        staffId: id.outsider!,
        weekday: 1,
        startsAt: '06:00',
        endsAt: '14:00',
        validFrom: '2027-05-03',
      })
      .returning({ id: shiftSeries.id });
    const [foreignOne] = await systemDb
      .insert(shifts)
      .values({
        gymId: otherGymId,
        staffId: id.outsider!,
        date: '2027-05-05',
        startsAt: '09:00',
        endsAt: '12:00',
      })
      .returning({ id: shifts.id });
    expect((await schedule('2027-05-03', '2027-05-16')).shifts.map((s) => s.staffId)).not.toContain(
      id.outsider,
    );
    await req('post', `/shift-series/${foreign!.id}/end`, 'owner')
      .send({ lastDate: '2027-05-09' })
      .expect(404);
    await req('put', `/shift-series/${foreign!.id}/occurrences/2027-05-10`, 'owner')
      .send({ cancelled: true })
      .expect(404);
    await req('delete', `/shifts/${foreignOne!.id}`, 'owner').expect(404);
    await req('patch', `/shifts/${foreignOne!.id}`, 'owner').send({ endsAt: '13:00' }).expect(404);
  });

  it('removing a trainer role deletes their shifts from today on, keeps earlier days, and drops unstarted series', async () => {
    await person('t9', ['trainer', 'member']);
    clock.current = at('2027-05-10', '10:00'); // Monday
    const started = (
      (await newSeries('owner', { staffId: id.t9, validFrom: '2027-05-10' }).expect(201)).body as {
        id: string;
      }
    ).id;
    const future = (
      (
        await newSeries('owner', { staffId: id.t9, validFrom: '2027-05-17', weekday: 2 }).expect(
          201,
        )
      ).body as { id: string }
    ).id;
    await req('put', `/shift-series/${started}/occurrences/2027-05-17`, 'owner')
      .send({ startsAt: '10:00', endsAt: '12:00' })
      .expect(200);
    await req('post', '/shifts', 'owner')
      .send({ staffId: id.t9, date: '2027-05-12', startsAt: '09:00', endsAt: '12:00' })
      .expect(201);
    // a one-off dated today is on the boundary and goes too
    await req('post', '/shifts', 'owner')
      .send({ staffId: id.t9, date: '2027-05-10', startsAt: '15:00', endsAt: '16:00' })
      .expect(201);
    // yesterday's one-off and a past-started series, seeded directly (the API refuses the past)
    await systemDb.insert(shifts).values({
      gymId,
      staffId: id.t9!,
      date: '2027-05-09',
      startsAt: '09:00',
      endsAt: '12:00',
    });
    const [old] = await systemDb
      .insert(shiftSeries)
      .values({
        gymId,
        staffId: id.t9!,
        weekday: 1,
        startsAt: '06:00',
        endsAt: '14:00',
        validFrom: '2027-05-03',
      })
      .returning({ id: shiftSeries.id });

    await req('delete', `/staff/${id.t9}/roles/trainer`, 'owner').expect(204);

    const left = (await schedule('2027-05-01', '2027-05-31')).shifts.filter(
      (s) => s.staffId === id.t9,
    );
    expect(brief(left)).toEqual(['2027-05-03 06:00-14:00', '2027-05-09 09:00-12:00']);
    const series = await systemDb
      .select()
      .from(shiftSeries)
      .where(and(eq(shiftSeries.gymId, gymId), eq(shiftSeries.staffId, id.t9!)));
    expect(series.map((s) => [s.id, s.validUntil])).toEqual(
      expect.arrayContaining([[old!.id, '2027-05-09']]),
    );
    expect(series.map((s) => s.id)).not.toContain(started); // began today: deleted
    expect(series.map((s) => s.id)).not.toContain(future); // not started: deleted
  });

  it('records each change in the history', async () => {
    const rows = await systemDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.gymId, gymId),
          inArray(auditLog.action, [
            'shift_series.created',
            'shift_series.ended',
            'shift.created',
            'shift.updated',
            'shift.cancelled',
          ]),
        ),
      );
    const seen = new Set(rows.map((r) => r.action));
    expect([...seen].sort()).toEqual([
      'shift.cancelled',
      'shift.created',
      'shift.updated',
      'shift_series.created',
      'shift_series.ended',
    ]);
  });

  it('ending a series on the day before it starts deletes it with its overrides ("edit from the first day")', async () => {
    await person('tedit', ['trainer']);
    clock.current = at('2027-05-03', '10:00'); // Monday
    const starting = (
      (await newSeries('owner', { staffId: id.tedit, validFrom: '2027-05-03' }).expect(201)).body as {
        id: string;
      }
    ).id;
    await req('put', `/shift-series/${starting}/occurrences/2027-05-10`, 'owner')
      .send({ startsAt: '10:00', endsAt: '12:00' })
      .expect(200);
    // it starts today: its first occurrence is not past, so "from today on" removes the whole series
    await req('post', `/shift-series/${starting}/end`, 'owner')
      .send({ lastDate: '2027-05-02' })
      .expect(204);
    expect(await mine('tedit', '2027-05-01', '2027-05-31')).toEqual([]);
    expect(await systemDb.select().from(shiftSeries).where(eq(shiftSeries.id, starting))).toEqual(
      [],
    );
    expect(await systemDb.select().from(shifts).where(eq(shifts.seriesId, starting))).toEqual([]);
    await req('post', `/shift-series/${starting}/end`, 'owner')
      .send({ lastDate: '2027-05-02' })
      .expect(404);

    // a series that has already run cannot be deleted this way
    const [old] = await systemDb
      .insert(shiftSeries)
      .values({
        gymId,
        staffId: id.tedit!,
        weekday: 2,
        startsAt: '06:00',
        endsAt: '14:00',
        validFrom: '2027-04-27',
      })
      .returning({ id: shiftSeries.id });
    await req('post', `/shift-series/${old!.id}/end`, 'owner')
      .send({ lastDate: '2027-04-26' })
      .expect(400);
    const history = await systemDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, starting), eq(auditLog.action, 'shift_series.ended')));
    expect(history).toHaveLength(1);
    expect(history[0]!.data).toMatchObject({ deleted: true });
  });
});
