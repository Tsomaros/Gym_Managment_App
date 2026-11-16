import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import { gymRoles, gyms, invitations, users } from '../../src/db/schema';
import { withGym } from '../../src/db/tenant';

/** Drizzle wraps driver errors; the Postgres message lives on `cause`. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message}\n${e.cause?.message ?? ''}`;
  }
  throw new Error('expected the query to be rejected, but it succeeded');
}

const RLS_VIOLATION = /violates row-level security policy/;

describe('row-level security (gym isolation)', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let userA: string;
  let userB: string;

  const invitation = (gymId: string, invitedBy: string) => ({
    gymId,
    email: `invitee-${randomUUID()}@example.com`,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    roles: ['member' as const],
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    invitedBy,
  });

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Gym A ${run}` }, { name: `Gym B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `a-${run}@example.com`, firstName: 'Owner', lastName: 'A' },
        { email: `b-${run}@example.com`, firstName: 'Owner', lastName: 'B' },
      ])
      .returning({ id: users.id });
    userA = u[0]!.id;
    userB = u[1]!.id;
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: userA, role: 'owner' },
      { gymId: gymB, userId: userB, role: 'owner' },
    ]);
    await systemDb.insert(invitations).values([invitation(gymA, userA), invitation(gymB, userB)]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(invitations).where(inArray(invitations.gymId, gymIds));
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    const userIds = [userA, userB].filter(Boolean);
    if (userIds.length) await systemDb.delete(users).where(inArray(users.id, userIds));
    await closeDb();
  });

  it('runs the API as gym_app, which cannot bypass row-level security', async () => {
    const { rows } = await db.execute<{ role: string; bypass: boolean; superuser: boolean }>(
      sql`select current_user as role, rolbypassrls as bypass, rolsuper as superuser
          from pg_roles where rolname = current_user`,
    );
    expect(rows).toEqual([{ role: 'gym_app', bypass: false, superuser: false }]);
  });

  describe('gym_roles', () => {
    it('withGym(A) sees only gym A rows', async () => {
      const rows = await withGym(gymA, (tx) => tx.select().from(gymRoles));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ gymId: gymA, userId: userA, role: 'owner' });
    });

    it('withGym(A) can write its own gym rows (so the rejections below are RLS, not a broken setup)', async () => {
      const extra = await systemDb
        .insert(users)
        .values({ email: `extra-${run}@example.com`, firstName: 'Extra', lastName: 'Test' })
        .returning({ id: users.id });
      const extraId = extra[0]!.id;
      try {
        await withGym(gymA, (tx) =>
          tx.insert(gymRoles).values({ gymId: gymA, userId: extraId, role: 'trainer' }),
        );
        const rows = await withGym(gymA, (tx) => tx.select().from(gymRoles));
        expect(rows.map((r) => r.userId).sort()).toEqual([userA, extraId].sort());
        // gym B is untouched by A's write
        expect(await withGym(gymB, (tx) => tx.select().from(gymRoles))).toHaveLength(1);
      } finally {
        await systemDb.delete(gymRoles).where(eq(gymRoles.userId, extraId));
        await systemDb.delete(users).where(eq(users.id, extraId));
      }
    });

    it('withGym(A) cannot insert a row for gym B', async () => {
      const msg = await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(gymRoles).values({ gymId: gymB, userId: userA, role: 'trainer' }),
        ),
      );
      expect(msg).toMatch(RLS_VIOLATION);
    });

    it('withGym(A) cannot move its row to gym B', async () => {
      const msg = await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(gymRoles).set({ gymId: gymB }).where(eq(gymRoles.gymId, gymA)),
        ),
      );
      expect(msg).toMatch(RLS_VIOLATION);
    });

    it('withGym(A) cannot delete gym B rows', async () => {
      await withGym(gymA, (tx) => tx.delete(gymRoles).where(eq(gymRoles.gymId, gymB)));
      const stillThere = await systemDb.select().from(gymRoles).where(eq(gymRoles.gymId, gymB));
      expect(stillThere).toHaveLength(1);
    });

    it('returns no rows when no gym is set', async () => {
      expect(await db.select().from(gymRoles)).toEqual([]);
    });

    it('returns no rows on a pooled connection that had a gym set earlier', async () => {
      // set_config(..., true) leaves '' behind after the transaction; that must still mean "no gym".
      const client = await db.$client.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.gym_id', $1, true)`, [gymA]);
        await client.query('commit');
        const { rows } = await client.query('select * from gym_roles');
        expect(rows).toEqual([]);
      } finally {
        client.release();
      }
    });

    it('rejects an insert when no gym is set', async () => {
      const msg = await rejectionMessage(
        db.insert(gymRoles).values({ gymId: gymA, userId: userA, role: 'trainer' }),
      );
      expect(msg).toMatch(RLS_VIOLATION);
    });
  });

  describe('gyms', () => {
    it('withGym(A) sees exactly gym A', async () => {
      const rows = await withGym(gymA, (tx) => tx.select({ id: gyms.id }).from(gyms));
      expect(rows).toEqual([{ id: gymA }]);
    });

    it('returns no gyms when no gym is set', async () => {
      expect(await db.select().from(gyms)).toEqual([]);
    });

    it('gym_app cannot create a gym', async () => {
      const msg = await rejectionMessage(
        withGym(gymA, (tx) => tx.insert(gyms).values({ name: 'Rogue' })),
      );
      expect(msg).toMatch(/permission denied for table gyms/);
    });

    it('withGym(A) cannot rename gym B', async () => {
      await withGym(gymA, (tx) =>
        tx.update(gyms).set({ name: 'Hijacked' }).where(eq(gyms.id, gymB)),
      );
      const [b] = await systemDb.select({ name: gyms.name }).from(gyms).where(eq(gyms.id, gymB));
      expect(b?.name).toBe(`Gym B ${run}`);
    });
  });

  describe('invitations', () => {
    it('withGym(B) sees only gym B invitations', async () => {
      const rows = await withGym(gymB, (tx) => tx.select().from(invitations));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        gymId: gymB,
        firstName: 'Γιώργος',
        lastName: 'Παπαδόπουλος',
      });
    });

    it('withGym(B) cannot insert an invitation for gym A', async () => {
      const msg = await rejectionMessage(
        withGym(gymB, (tx) => tx.insert(invitations).values(invitation(gymA, userB))),
      );
      expect(msg).toMatch(RLS_VIOLATION);
    });

    it('returns no invitations when no gym is set', async () => {
      expect(await db.select().from(invitations)).toEqual([]);
    });
  });
});
