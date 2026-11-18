import type { AuditPage, Measurement } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { bodyMeasurements, gymRoles, healthConsents, trainerCovers } from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('body measurements: consent, access, withdrawal deletes', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('ME');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(bodyMeasurements).where(eq(bodyMeasurements.gymId, g));
      await systemDb.delete(healthConsents).where(eq(healthConsents.gymId, g));
    }),
  );

  const record = (who: string, member = 'm', over: object = {}) =>
    fx
      .req('post', `/members/${fx.id[member]}/measurements`, who)
      .send({ measuredOn: DAY, weightKg: 82.5, bodyFatPct: 18, ...over });
  const list = async (who: string, member = 'm') =>
    (await fx.req('get', `/members/${fx.id[member]}/measurements`, who).expect(200))
      .body as Measurement[];
  const rowsOf = (member: string) =>
    systemDb.select().from(bodyMeasurements).where(eq(bodyMeasurements.memberId, fx.id[member]!));
  const grant = (who: string) => fx.req('post', '/me/consents/measurements', who);

  it('recording without consent is a 409 and stores nothing', async () => {
    const res = await record('t').expect(409);
    expect(res.body.message).toBe('No consent');
    expect(await rowsOf('m')).toHaveLength(0);
    expect(await list('t')).toEqual([]);
  });

  it('after consent the trainer records and both the member and the trainer read it', async () => {
    await grant('m').expect(201);
    const res = await record('t', 'm', { waistCm: 84.5, notes: 'Πρώτη μέτρηση' }).expect(201);
    expect(res.body).toMatchObject({
      measuredOn: DAY,
      weightKg: 82.5,
      bodyFatPct: 18,
      waistCm: 84.5,
      hipsCm: null,
      notes: 'Πρώτη μέτρηση',
      recordedBy: fx.id.t,
    });
    expect(await list('t')).toEqual([res.body]);
    expect(await list('m', 'm')).toEqual([res.body]);
    expect((await fx.req('get', '/me/measurements', 'm').expect(200)).body).toEqual([res.body]);
  });

  it('lists newest measurement day first', async () => {
    await record('t', 'm', { measuredOn: '2027-05-01', weightKg: 84 }).expect(201);
    await record('t', 'm', { measuredOn: '2027-05-11', weightKg: 83 }).expect(201);
    expect((await list('t')).map((x) => x.measuredOn)).toEqual([DAY, '2027-05-11', '2027-05-01']);
  });

  it('refuses a future day, no values, and values out of range or with too many decimals', async () => {
    const bad = [
      { measuredOn: '2027-05-13' }, // tomorrow in the gym's time zone
      { measuredOn: '2027-5-1' },
      { weightKg: undefined, bodyFatPct: undefined },
      { weightKg: null, bodyFatPct: null },
      { bodyFatPct: 1 },
      { bodyFatPct: 71 },
      { weightKg: 19.9 },
      { weightKg: 400.5 },
      { weightKg: 82.555 },
      { bodyFatPct: 18.25 },
      { waistCm: 9.9 },
      { thighCm: 300.5 },
      { hipsCm: 9.9 },
      { chestCm: 300.5 },
      { armCm: 9.9 },
      { armCm: 20.25 },
      { notes: 'x'.repeat(301) },
    ];
    for (const over of bad) await record('t', 'm', over).expect(400);
    // the gym's "today" decides: late evening UTC on the 11th is already the 12th in Athens
    fx.clock.current = new Date('2027-05-11T22:30:00Z');
    await record('t', 'm', { measuredOn: DAY }).expect(201);
    await record('t', 'm', { measuredOn: '2027-05-13' }).expect(400);
    fx.clock.setDay(DAY);
  });

  it('accepts a single value and the exact bounds', async () => {
    await record('t', 'm', { weightKg: undefined, bodyFatPct: undefined, hipsCm: 10 }).expect(201);
    await record('t', 'm', { weightKg: 20, bodyFatPct: 2, chestCm: 300 }).expect(201);
    await record('t', 'm', { weightKg: 400, bodyFatPct: 70 }).expect(201);
    await record('t', 'm', { armCm: 10, notes: 'x'.repeat(300) }).expect(201);
  });

  it('only the primary trainer records: the member and a cover trainer get 403', async () => {
    await record('m').expect(403);
    await systemDb
      .insert(trainerCovers)
      .values({ gymId: fx.gymId, memberId: fx.id.m!, trainerId: fx.id.u!, date: DAY });
    await record('u').expect(403);
    await list('u'); // may read today
    fx.clock.setDay('2027-05-13');
    await fx.req('get', `/members/${fx.id.m}/measurements`, 'u').expect(404);
    await record('u').expect(404);
    fx.clock.setDay(DAY);
    await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, fx.gymId));
  });

  it('owner, reception, other members and trainers who are not theirs get 404', async () => {
    for (const who of ['owner', 'rec', 'n', 'u']) {
      await fx.req('get', `/members/${fx.id.m}/measurements`, who).expect(404);
      await record(who).expect(404);
    }
    await fx.req('get', `/members/${fx.id.stranger}/measurements`, 't').expect(404);
  });

  it('the primary trainer deletes one measurement and the history keeps no values', async () => {
    const [mine] = await list('t');
    await fx.req('delete', `/members/${fx.id.m}/measurements/${mine!.id}`, 'm').expect(403);
    await fx.req('delete', `/members/${fx.id.m}/measurements/${mine!.id}`, 'owner').expect(404);
    // t is also n's trainer, but m's measurement id under n's path is not found and survives
    await fx.req('delete', `/members/${fx.id.n}/measurements/${mine!.id}`, 't').expect(404);
    expect(await list('t')).toContainEqual(mine);
    await fx.req('delete', `/members/${fx.id.m}/measurements/${mine!.id}`, 't').expect(204);
    await fx.req('delete', `/members/${fx.id.m}/measurements/${mine!.id}`, 't').expect(404);
    const page = (await fx.req('get', '/audit?entity=measurement&limit=100', 'owner').expect(200))
      .body as AuditPage;
    expect(page.entries.map((e) => e.action)).toContain('measurement.deleted');
    expect(page.entries.map((e) => e.action)).toContain('measurement.recorded');
    for (const e of page.entries) {
      expect(e.data).toEqual({ memberId: fx.id.m });
      // none of the recorded values or the note text (82.5 kg, 84.5 cm, the Greek note) leaks
      expect(JSON.stringify(e)).not.toMatch(/82\.5|84\.5|Πρώτη/);
    }
  });

  it('withdrawing deletes the member’s measurements only; recording is a 409 again until consent returns', async () => {
    await grant('n').expect(201);
    await record('t', 'n', { weightKg: 70 }).expect(201);
    const before = (await rowsOf('m')).length;
    expect(before).toBeGreaterThan(1);

    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
    expect(await rowsOf('m')).toHaveLength(0);
    expect(await list('t')).toEqual([]);
    expect(await list('m')).toEqual([]);
    expect(await rowsOf('n')).toHaveLength(1); // another member's data is untouched
    await record('t').expect(409);

    const page = (
      await fx.req('get', '/audit?entity=health_consent&limit=100', 'owner').expect(200)
    ).body as AuditPage;
    const w = page.entries.find(
      (e) => e.action === 'consent.withdrawn' && e.actor?.id === fx.id.m,
    )!;
    expect(w.data).toEqual({ kind: 'measurements', deleted: before });

    await grant('m').expect(201);
    await record('t').expect(201);
    expect(await list('t')).toHaveLength(1);
  });

  it('withdrawing in one gym keeps the same person’s measurements in another gym', async () => {
    await systemDb
      .insert(gymRoles)
      .values({ gymId: fx.otherGymId, userId: fx.id.m!, role: 'member' } as never);
    await fx.req('post', '/me/consents/measurements', 'm', fx.otherGymId).expect(201);
    await systemDb.insert(bodyMeasurements).values({
      gymId: fx.otherGymId,
      memberId: fx.id.m!,
      measuredOn: DAY,
      weightKg: '75',
    });
    // m has consent and one measurement here too (granted again at the end of the previous test)
    expect((await rowsOf('m')).filter((r) => r.gymId === fx.gymId).length).toBeGreaterThan(0);
    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
    const left = await rowsOf('m');
    expect(left.map((r) => r.gymId)).toEqual([fx.otherGymId]);
  });

  it('keeps the gyms apart: consent given in one gym is nothing in the other', async () => {
    // the stranger is a member of the other gym only
    await fx.req('post', '/me/consents/measurements', 'stranger', fx.otherGymId).expect(201);
    await fx.req('post', '/me/consents/measurements', 'stranger').expect(403); // no role here
    const rows = await systemDb
      .select()
      .from(healthConsents)
      .where(eq(healthConsents.memberId, fx.id.stranger!));
    expect(rows.map((r) => r.gymId)).toEqual([fx.otherGymId]);
    await record('t', 'stranger').expect(404);
    expect(await rowsOf('stranger')).toHaveLength(0);
  });
});
