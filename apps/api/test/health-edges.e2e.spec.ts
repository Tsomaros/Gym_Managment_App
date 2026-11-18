import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { bodyMeasurements, healthConsents } from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

/** Edge cases found in review: a clock that steps back, odd characters, absurd dates. */
describe('health data edges', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('HE');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(bodyMeasurements).where(eq(bodyMeasurements.gymId, g));
      await systemDb.delete(healthConsents).where(eq(healthConsents.gymId, g));
    }),
  );

  const record = (over: object = {}) =>
    fx
      .req('post', `/members/${fx.id.m}/measurements`, 't')
      .send({ measuredOn: DAY, weightKg: 80, ...over });

  it('withdrawing still works when the server clock stepped back after the grant', async () => {
    fx.clock.setDay('2027-05-13');
    await fx.req('post', '/me/consents/measurements', 'm').expect(201);
    fx.clock.setDay(DAY);
    await record().expect(201);
    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
    const rows = await systemDb
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.memberId, fx.id.m!));
    expect(rows).toHaveLength(0);
    const [consent] = await systemDb
      .select()
      .from(healthConsents)
      .where(eq(healthConsents.memberId, fx.id.m!));
    // greatest(now, grantedAt): the clock is behind the grant, so the grant time is used
    expect(consent!.withdrawnAt!.getTime()).toBe(consent!.grantedAt.getTime());
    // and the withdrawal really ended the consent
    await record().expect(409);
  });

  it('refuses a NUL character in the notes and a day before 1900 instead of failing with a 500', async () => {
    await fx.req('post', '/me/consents/measurements', 'm').expect(201);
    await record({ notes: 'a\u0000b' }).expect(400);
    await record({ measuredOn: '1899-12-31' }).expect(400);
    await record({ measuredOn: '1900-01-01' }).expect(201);
  });

  it('a measurement sent without a day is dated by the gym’s calendar, not the sender’s', async () => {
    // 00:30 in Athens on the 12th, still the 11th in UTC
    fx.clock.current = new Date('2027-05-11T22:30:00Z');
    if (!(await fx.req('get', `/members/${fx.id.m}/consents`, 't')).body.measurements.granted) {
      await fx.req('post', '/me/consents/measurements', 'm').expect(201);
    }
    const res = await fx
      .req('post', `/members/${fx.id.m}/measurements`, 't')
      .send({ weightKg: 79 })
      .expect(201);
    expect(res.body.measuredOn).toBe('2027-05-12');
    fx.clock.setDay(DAY);
  });
});
