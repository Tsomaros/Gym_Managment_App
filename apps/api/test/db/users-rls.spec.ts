import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import { gymRoles, gyms, users } from '../../src/db/schema';
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

describe('row-level security on users (gym_app)', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let inA: string;
  let inBoth: string;
  let inBOnly: string;
  let noGym: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Users A ${run}` }, { name: `Users B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `ua-${run}@example.com`, firstName: 'In', lastName: 'A' },
        { email: `uab-${run}@example.com`, firstName: 'In', lastName: 'Both' },
        { email: `ub-${run}@example.com`, firstName: 'In', lastName: 'B only' },
        { email: `un-${run}@example.com`, firstName: 'No', lastName: 'gym' },
      ])
      .returning({ id: users.id });
    [inA, inBoth, inBOnly, noGym] = u.map((r) => r.id) as [string, string, string, string];
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId: inA, role: 'member' },
      // Two roles in gym A: the user must still appear once.
      { gymId: gymA, userId: inBoth, role: 'member' },
      { gymId: gymA, userId: inBoth, role: 'trainer' },
      { gymId: gymB, userId: inBoth, role: 'member' },
      { gymId: gymB, userId: inBOnly, role: 'member' },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(gymRoles).where(inArray(gymRoles.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    const ids = [inA, inBoth, inBOnly, noGym].filter(Boolean);
    if (ids.length) await systemDb.delete(users).where(inArray(users.id, ids));
    await closeDb();
  });

  it('withGym(A) sees exactly the users who hold a role in gym A, each once', async () => {
    const rows = await withGym(gymA, (tx) => tx.select({ id: users.id }).from(users));
    expect(rows.map((r) => r.id).sort()).toEqual([inA, inBoth].sort());
  });

  it('withGym(B) sees the gym B users, not gym A only ones', async () => {
    const rows = await withGym(gymB, (tx) => tx.select({ id: users.id }).from(users));
    expect(rows.map((r) => r.id).sort()).toEqual([inBoth, inBOnly].sort());
  });

  it('sees no users at all when no gym is set, even right after a gym transaction', async () => {
    // A pooled connection keeps app.gym_id = '' after withGym; that must not leak or error.
    await withGym(gymA, (tx) => tx.select({ id: users.id }).from(users));
    expect(await db.select({ id: users.id }).from(users)).toEqual([]);
  });

  it('cannot update users through its own gym either', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx
          .update(users)
          .set({ firstName: 'Hacked', lastName: 'Test' })
          .where(inArray(users.id, [inA])),
      ),
    );
    expect(msg).toMatch(/permission denied/);
  });

  it('cannot insert users', async () => {
    const msg = await rejectionMessage(
      db
        .insert(users)
        .values({ email: `ins-${run}@example.com`, firstName: 'Nope', lastName: 'Test' }),
    );
    expect(msg).toMatch(/permission denied/);
  });

  it('systemDb (gym_system) still sees every user', async () => {
    const rows = await systemDb
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [inA, inBoth, inBOnly, noGym]));
    expect(rows).toHaveLength(4);
  });
});
