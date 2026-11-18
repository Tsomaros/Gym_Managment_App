import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb } from '../src/db/client';
import { trainerCovers } from '../src/db/schema';
import { withGym } from '../src/db/tenant';
import { healthAccess } from '../src/workouts/health-access';
import { DAY, type HealthFixture, setupHealthFixture } from './helpers/fixture';

const roleOf = {
  owner: ['owner'],
  rec: ['reception'],
  t: ['trainer'],
  u: ['trainer'],
  m: ['member'],
  n: ['member'],
} as const;

describe('healthAccess: who may read and write a member’s health data', () => {
  let fx: HealthFixture;
  beforeAll(async () => {
    fx = await setupHealthFixture('HA');
  });
  afterAll(async () => fx?.cleanup());

  const access = (who: keyof typeof roleOf, member: string, today = DAY) =>
    withGym(fx.gymId, (tx) =>
      healthAccess(
        tx,
        fx.gymId,
        { userId: fx.id[who]!, roles: [...roleOf[who]] },
        fx.id[member]!,
        today,
      ),
    );
  const none = { read: false, writeMeasurements: false, writePhotos: false, writeSessions: false };

  it('the member reads, adds photos and logs sessions, but cannot record measurements', async () => {
    expect(await access('m', 'm')).toEqual({
      read: true,
      writeMeasurements: false,
      writePhotos: true,
      writeSessions: true,
    });
  });

  it('the primary trainer reads and records measurements and photos, but never logs sessions', async () => {
    expect(await access('t', 'm')).toEqual({
      read: true,
      writeMeasurements: true,
      writePhotos: true,
      writeSessions: false,
    });
  });

  it('a cover trainer only reads, and only on the day of the cover', async () => {
    await systemDb
      .insert(trainerCovers)
      .values({ gymId: fx.gymId, memberId: fx.id.m!, trainerId: fx.id.u!, date: DAY });
    expect(await access('u', 'm')).toEqual({ ...none, read: true });
    expect(await access('u', 'm', '2027-05-13')).toEqual(none);
    await systemDb.delete(trainerCovers).where(eq(trainerCovers.gymId, fx.gymId));
    expect(await access('u', 'm')).toEqual(none);
  });

  it('the owner, reception, another member and a trainer who is not theirs get nothing', async () => {
    expect(await access('owner', 'm')).toEqual(none);
    expect(await access('rec', 'm')).toEqual(none);
    expect(await access('n', 'm')).toEqual(none);
    expect(await access('u', 'm')).toEqual(none);
  });

  it('a paused trainer link (no current membership with a trainer) gives the trainer nothing', async () => {
    expect(await access('t', 'n', '2027-07-01')).toEqual(none);
    // the member still has full access to their own data
    expect((await access('n', 'n', '2027-07-01')).read).toBe(true);
  });

  it('a person who holds no member role gets nothing, even for themself', async () => {
    expect(await access('t', 't')).toEqual(none);
  });
});
