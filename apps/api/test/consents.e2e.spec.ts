import type { AuditPage, ConsentState } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { bodyMeasurements, gymRoles, healthConsents, trainerCovers } from '../src/db/schema';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

describe('health consent: grant, withdraw, who may see it', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('CO');
  });
  afterAll(async () =>
    fx?.cleanup(async (g) => {
      await systemDb.delete(bodyMeasurements).where(eq(bodyMeasurements.gymId, g));
      await systemDb.delete(healthConsents).where(eq(healthConsents.gymId, g));
    }),
  );

  const state = async (who: string, member = 'm') =>
    (await fx.req('get', `/members/${fx.id[member]}/consents`, who).expect(200))
      .body as ConsentState;
  const active = (member = 'm', kind = 'measurements') =>
    systemDb
      .select()
      .from(healthConsents)
      .where(
        and(
          eq(healthConsents.gymId, fx.gymId),
          eq(healthConsents.memberId, fx.id[member]!),
          eq(healthConsents.kind, kind),
        ),
      );
  it('starts with nothing granted, for the member and their trainer alike', async () => {
    const none = { granted: false, at: null };
    expect(await state('m')).toEqual({ measurements: none, photos: none });
    expect(await state('t')).toEqual({ measurements: none, photos: none });
    expect((await fx.req('get', '/me/consents', 'm').expect(200)).body).toEqual({
      measurements: none,
      photos: none,
    });
  });

  it('granting creates one row (201) and granting again changes nothing (200)', async () => {
    const first = await fx.req('post', '/me/consents/measurements', 'm').expect(201);
    expect(first.body.measurements).toMatchObject({ granted: true });
    expect(first.body.photos).toEqual({ granted: false, at: null });
    const [row] = await active();
    expect(row).toMatchObject({ textVersion: 'v1', withdrawnAt: null });
    const again = await fx.req('post', '/me/consents/measurements', 'm').expect(200);
    expect(again.body.measurements.at).toBe(first.body.measurements.at);
    expect(await active()).toHaveLength(1);
    // the kinds are independent
    expect((await state('t')).photos.granted).toBe(false);
    expect((await state('t')).measurements.granted).toBe(true);
  });

  it('two grants sent at once leave exactly one active row', async () => {
    const res = await Promise.all([
      fx.req('post', '/me/consents/photos', 'n'),
      fx.req('post', '/me/consents/photos', 'n'),
      fx.req('post', '/me/consents/photos', 'n'),
    ]);
    // one request wins (201); the others see its consent (200), none fails with a unique violation
    expect(res.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await active('n', 'photos')).toHaveLength(1);
  });

  it('rejects an unknown kind, and only the member may grant or withdraw', async () => {
    await fx.req('post', '/me/consents/dna', 'm').expect(400);
    await fx.req('delete', '/me/consents/dna', 'm').expect(400);
    for (const who of ['t', 'owner', 'rec']) {
      await fx.req('post', '/me/consents/measurements', who).expect(403);
      await fx.req('delete', '/me/consents/measurements', who).expect(403);
    }
  });

  it('records the grant and the withdrawal in the history, with no values', async () => {
    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
    const page = (
      await fx.req('get', '/audit?entity=health_consent&limit=100', 'owner').expect(200)
    ).body as AuditPage;
    const mine = page.entries.filter((e) => e.actor?.id === fx.id.m);
    expect(mine.map((e) => e.action).sort()).toEqual(['consent.granted', 'consent.withdrawn']);
    const withdrawn = mine.find((e) => e.action === 'consent.withdrawn')!;
    expect(withdrawn.data).toEqual({ kind: 'measurements', deleted: 0 });
    const [row] = await active();
    expect(row!.withdrawnAt).not.toBeNull();
    expect((await state('t')).measurements.granted).toBe(false);
    // withdrawing what is not granted does nothing and writes no second entry
    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
    const after = (
      await fx.req('get', '/audit?entity=health_consent&limit=100', 'owner').expect(200)
    ).body as AuditPage;
    expect(
      after.entries.filter((e) => e.action === 'consent.withdrawn' && e.actor?.id === fx.id.m),
    ).toHaveLength(1);
    // consent can be given again: a new row, the old one stays as evidence
    await fx.req('post', '/me/consents/measurements', 'm').expect(201);
    expect(await active()).toHaveLength(2);
    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
  });

  it('a cover trainer reads the state today and gets 404 the next day; owner, reception and others 404', async () => {
    await systemDb
      .insert(trainerCovers)
      .values({ gymId: fx.gymId, memberId: fx.id.m!, trainerId: fx.id.u!, date: DAY });
    await state('u');
    fx.clock.setDay('2027-05-13');
    await fx.req('get', `/members/${fx.id.m}/consents`, 'u').expect(404);
    fx.clock.setDay(DAY);
    await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, fx.gymId));
    for (const who of ['owner', 'rec', 'n', 'u']) {
      await fx.req('get', `/members/${fx.id.m}/consents`, who).expect(404);
    }
  });

  it('is per gym: another gym’s member has their own state', async () => {
    await fx.req('post', '/me/consents/measurements', 'stranger', fx.otherGymId).expect(201);
    await fx.req('get', `/members/${fx.id.stranger}/consents`, 't').expect(404);
  });

  it('one person in two gyms has a separate consent in each', async () => {
    // m (withdrawn in this gym by now) also joins the other gym
    await systemDb
      .insert(gymRoles)
      .values({ gymId: fx.otherGymId, userId: fx.id.m!, role: 'member' } as never);
    await fx.req('post', '/me/consents/measurements', 'm', fx.otherGymId).expect(201);
    expect((await state('t')).measurements.granted).toBe(false);
    expect((await fx.req('get', '/me/consents', 'm').expect(200)).body.measurements.granted).toBe(
      false,
    );
    // granting here is new here, even though the other gym already has one
    await fx.req('post', '/me/consents/measurements', 'm').expect(201);
    expect((await state('t')).measurements.granted).toBe(true);
    // withdrawing here leaves the other gym's consent alone
    await fx.req('delete', '/me/consents/measurements', 'm').expect(204);
    expect((await state('t')).measurements.granted).toBe(false);
    const other = await fx.req('get', '/me/consents', 'm', fx.otherGymId).expect(200);
    expect(other.body.measurements.granted).toBe(true);
  });
});
