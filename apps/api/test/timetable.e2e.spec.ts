import type { ClassSessionView, ClassTypeView } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TimetableService } from '../src/classes/timetable.service';
import { systemDb } from '../src/db/client';
import { classSeries, classSessions, classTypes } from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

// DAY = 2027-05-12, a Wednesday; the gym is in Athens (UTC+3 in May), the test clock is 09:00Z = 12:00 local.
describe('class types, timetable series and sessions', () => {
  let f: HealthFixture;
  let spinning: ClassTypeView;
  let timetable: TimetableService;
  const list = async (from: string, to: string, who = 'owner'): Promise<ClassSessionView[]> =>
    (await f.req('get', `/class-sessions?from=${from}&to=${to}`, who).expect(200))
      .body as ClassSessionView[];
  const seriesBody = (over: Record<string, unknown> = {}) => ({
    classTypeId: spinning.id,
    weekday: 3,
    startsAt: '18:00',
    durationMinutes: 45,
    capacity: 12,
    validFrom: DAY,
    ...over,
  });

  beforeAll(async () => {
    f = await setupHealthFixture('Timetable');
    timetable = f.app.get(TimetableService);
    spinning = (
      await f
        .req('post', '/class-types', 'owner')
        .send({
          name: 'Σπινινγκ',
          nameEn: 'Spinning',
          defaultCapacity: 12,
          defaultDurationMinutes: 45,
        })
        .expect(201)
    ).body as ClassTypeView;
  });

  afterAll(async () => {
    await f.cleanup(async (g) => {
      await systemDb.delete(classSessions).where(eq(classSessions.gymId, g));
      await systemDb.delete(classSeries).where(eq(classSeries.gymId, g));
      await systemDb.delete(classTypes).where(eq(classTypes.gymId, g));
    });
  });

  it('a series makes sessions for 28 days; running the job again adds none', async () => {
    const created = await f.req('post', '/class-series', 'owner').send(seriesBody()).expect(201);
    expect(created.body.id).toEqual(expect.any(String));
    const first = await list(DAY, '2027-06-11');
    expect(first.map((s) => s.date)).toEqual([
      '2027-05-12',
      '2027-05-19',
      '2027-05-26',
      '2027-06-02',
    ]);
    expect(first[0]).toMatchObject({
      startsAt: '18:00',
      endsAt: '18:45',
      capacity: 12,
      cancelled: false,
      type: { name: 'Σπινινγκ', nameEn: 'Spinning' },
    });
    await timetable.materialiseAll(f.clock.now());
    expect(await list(DAY, '2027-06-11')).toHaveLength(4);
  });

  it('the sessions hold the real instants of the gym time zone', async () => {
    const rows = await systemDb
      .select()
      .from(classSessions)
      .where(eq(classSessions.gymId, f.gymId));
    const first = rows.find((r) => r.date === '2027-05-12')!;
    expect(first.startsAtUtc.toISOString()).toBe('2027-05-12T15:00:00.000Z');
    expect(first.endsAtUtc.toISOString()).toBe('2027-05-12T15:45:00.000Z');
  });

  it('ending the series from next week removes later sessions and keeps past and today’s', async () => {
    const [s] = await systemDb.select().from(classSeries).where(eq(classSeries.gymId, f.gymId));
    f.clock.current = new Date('2027-05-12T17:00:00Z'); // 20:00 local: today's class has started
    await f
      .req('post', `/class-series/${s!.id}/end`, 'owner')
      .send({ lastDate: '2027-05-11' })
      .expect(204);
    // Ended yesterday: the future ones go, today's (already started) stays.
    expect((await list(DAY, '2027-06-11')).map((x) => x.date)).toEqual(['2027-05-12']);
    await timetable.materialiseAll(f.clock.now());
    expect(await list(DAY, '2027-06-11')).toHaveLength(1);
    // Past days cannot change.
    await f
      .req('post', `/class-series/${s!.id}/end`, 'owner')
      .send({ lastDate: '2027-05-01' })
      .expect(400);
    f.clock.setDay(DAY);
  });

  it('ending a series from next week keeps this week and drops the weeks after', async () => {
    const made = await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ weekday: 2, startsAt: '07:00', validFrom: '2027-05-13' }))
      .expect(201);
    expect((await list('2027-05-13', '2027-06-11')).filter((x) => x.seriesId === made.body.id)).toHaveLength(
      4,
    );
    await f
      .req('post', `/class-series/${made.body.id}/end`, 'owner')
      .send({ lastDate: '2027-05-18' })
      .expect(204);
    expect(
      (await list('2027-05-13', '2027-06-11'))
        .filter((x) => x.seriesId === made.body.id)
        .map((x) => x.date),
    ).toEqual(['2027-05-18']);
    await f
      .req('post', `/class-series/${made.body.id}/end`, 'owner')
      .send({ lastDate: '2027-05-25' })
      .expect(400); // a series cannot be extended
  });

  it('materialising while a series is ended never leaves sessions past its end', async () => {
    const made = await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ weekday: 7, startsAt: '09:00', validFrom: '2027-05-16' }))
      .expect(201);
    await Promise.all([
      f.req('post', `/class-series/${made.body.id}/end`, 'owner').send({ lastDate: '2027-05-16' }),
      timetable.materialiseGym(f.gymId),
      timetable.materialiseGym(f.gymId),
    ]);
    const rows = await systemDb
      .select()
      .from(classSessions)
      .where(eq(classSessions.seriesId, made.body.id));
    expect(rows.map((r) => r.date)).toEqual(['2027-05-16']);
  });

  it('a one-off session appears in the list; reception cancels it, a trainer cannot', async () => {
    const made = await f
      .req('post', '/class-sessions', 'owner')
      .send({
        classTypeId: spinning.id,
        date: '2027-05-14',
        startsAt: '10:00',
        durationMinutes: 60,
        capacity: 8,
        trainerId: f.id.t,
        room: 'A',
      })
      .expect(201);
    const day = await list('2027-05-14', '2027-05-14', 'm');
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({
      id: made.body.id,
      room: 'A',
      trainer: { firstName: 't' },
      seriesId: null,
    });
    await f
      .req('post', `/class-sessions/${made.body.id}/cancel`, 't')
      .send({ reason: 'x' })
      .expect(403);
    await f
      .req('post', `/class-sessions/${made.body.id}/cancel`, 'rec')
      .send({ reason: 'Ασθένεια' })
      .expect(204);
    expect((await list('2027-05-14', '2027-05-14'))[0]).toMatchObject({ cancelled: true });
    // Cancelling again changes nothing.
    await f.req('post', `/class-sessions/${made.body.id}/cancel`, 'rec').send({}).expect(204);
    // The first reason is kept.
    const [row] = await systemDb.select().from(classSessions).where(eq(classSessions.id, made.body.id));
    expect(row!.cancelReason).toBe('Ασθένεια');
    // Members and people of another gym cannot cancel; the session stays cancelled only by reception.
    const other = await f
      .req('post', '/class-sessions', 'owner')
      .send({ classTypeId: spinning.id, date: '2027-05-15', startsAt: '10:00', durationMinutes: 60, capacity: 8 })
      .expect(201);
    await f.req('post', `/class-sessions/${other.body.id}/cancel`, 'm').send({}).expect(403);
    await f.req('post', `/class-sessions/${other.body.id}/cancel`, 'stranger').send({}).expect(403);
    expect((await list('2027-05-15', '2027-05-15')).map((s) => s.cancelled)).toEqual([false]);
  });

  it('only the owner creates series and one-off sessions', async () => {
    const session = {
      classTypeId: spinning.id,
      date: '2027-05-17', // a Monday: no series in this file runs on it
      startsAt: '10:00',
      durationMinutes: 60,
      capacity: 8,
    };
    for (const who of ['rec', 't', 'm', 'stranger']) {
      await f.req('post', '/class-sessions', who).send(session).expect(403);
      await f.req('post', '/class-series', who).send(seriesBody()).expect(403);
    }
    expect(await list('2027-05-17', '2027-05-17')).toEqual([]);
  });

  it('a class in the hour that does not exist on the spring switch day can still be created', async () => {
    f.clock.current = new Date('2027-03-20T10:00:00Z');
    try {
      const made = await f
        .req('post', '/class-sessions', 'owner')
        .send({
          classTypeId: spinning.id,
          date: '2027-03-28',
          startsAt: '03:30',
          durationMinutes: 30,
          capacity: 5,
        })
        .expect(201);
      const [row] = await systemDb.select().from(classSessions).where(eq(classSessions.id, made.body.id));
      expect(row!.endsAtUtc.getTime() - row!.startsAtUtc.getTime()).toBe(30 * 60_000);
    } finally {
      f.clock.setDay(DAY);
    }
  });

  it('members can list; people of another gym cannot', async () => {
    await list(DAY, DAY, 'm');
    await f.req('get', `/class-sessions?from=${DAY}&to=${DAY}`, 'stranger').expect(403);
  });

  it('rejects ranges over 31 days, capacity 0, a non-trainer and a series that crosses midnight', async () => {
    await f.req('get', `/class-sessions?from=${DAY}&to=2027-06-12`, 'owner').expect(400);
    await f.req('post', '/class-series', 'owner').send(seriesBody({ capacity: 0 })).expect(400);
    await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ trainerId: f.id.m }))
      .expect(404);
    await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ startsAt: '23:30', durationMinutes: 45 }))
      .expect(400);
    await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ startsAt: '23:00', durationMinutes: 60 }))
      .expect(400); // ending exactly at midnight is refused too
    await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ validFrom: '2027-05-01' }))
      .expect(400);
    await f.req('post', '/class-series', 'rec').send(seriesBody()).expect(403);
  });

  it('removing a trainer’s role keeps their classes running without a trainer', async () => {
    const made = await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ weekday: 5, trainerId: f.id.u, validFrom: '2027-05-14' }))
      .expect(201);
    expect(
      (await list('2027-05-14', '2027-05-14')).find((s) => s.trainer?.firstName === 'u'),
    ).toBeDefined();
    await f.req('delete', `/staff/${f.id.u}/roles/trainer`, 'owner').expect(204);
    const after = (await list('2027-05-14', '2027-06-11')).filter((s) => s.seriesId === made.body.id);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((s) => s.trainer === null)).toBe(true);
    await timetable.materialiseAll(f.clock.now());
    const [row] = await systemDb.select().from(classSeries).where(eq(classSeries.id, made.body.id));
    expect(row!.trainerId).toBeNull();
  });

  it('the cancel cut-off is a gym setting (0–1440)', async () => {
    expect(
      (await f.req('get', '/settings', 'owner').expect(200)).body.classCancelCutoffMinutes,
    ).toBe(120);
    await f.req('patch', '/settings', 'owner').send({ classCancelCutoffMinutes: 60 }).expect(200);
    await f.req('patch', '/settings', 'owner').send({ classCancelCutoffMinutes: 1441 }).expect(400);
    await f.req('patch', '/settings', 'owner').send({ classCancelCutoffMinutes: 120 }).expect(200);
  });

  it('class types: reception cannot edit; archived types cannot get new series', async () => {
    await f
      .req('post', '/class-types', 'rec')
      .send({ name: 'X', defaultCapacity: 5, defaultDurationMinutes: 30 })
      .expect(403);
    const pil = (
      await f
        .req('post', '/class-types', 'owner')
        .send({ name: 'Πιλάτες', defaultCapacity: 10, defaultDurationMinutes: 50 })
        .expect(201)
    ).body as ClassTypeView;
    await f.req('patch', `/class-types/${pil.id}`, 'owner').send({ description: 'Mat' }).expect(200);
    await f.req('post', `/class-types/${pil.id}/archive`, 'owner').expect(204);
    await f
      .req('post', '/class-series', 'owner')
      .send(seriesBody({ classTypeId: pil.id }))
      .expect(404);
    const types = (await f.req('get', '/class-types', 'rec').expect(200)).body as ClassTypeView[];
    expect(types.find((t) => t.id === pil.id)).toMatchObject({
      archived: true,
      description: 'Mat',
    });
  });
});
