import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import { gyms, users } from '../../src/db/schema';
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

afterAll(async () => {
  await closeDb();
});

describe('gym_app privileges on global and gym tables', () => {
  const run = randomUUID().slice(0, 8);
  let userId: string;
  let gymId: string;

  beforeAll(async () => {
    const [u] = await systemDb
      .insert(users)
      .values({ email: `priv-${run}@example.com`, fullName: 'Plain User' })
      .returning({ id: users.id });
    userId = u!.id;
    const [g] = await systemDb
      .insert(gyms)
      .values({ name: `Priv Gym ${run}` })
      .returning({ id: gyms.id });
    gymId = g!.id;
  });

  afterAll(async () => {
    await systemDb.delete(users).where(sql`${users.email} like ${`%-${run}@example.com`}`);
    if (gymId) await systemDb.delete(gyms).where(eq(gyms.id, gymId));
  });

  it('can create an ordinary account (invitation acceptance needs this)', async () => {
    const [created] = await db
      .insert(users)
      .values({ email: `new-${run}@example.com`, fullName: 'Μαρία Νέα' })
      .returning({ isPlatformAdmin: users.isPlatformAdmin, fullName: users.fullName });
    expect(created).toEqual({ isPlatformAdmin: false, fullName: 'Μαρία Νέα' });
  });

  it('can change a name, locale or password hash', async () => {
    await db
      .update(users)
      .set({ fullName: 'Renamed', locale: 'en', passwordHash: 'x' })
      .where(eq(users.id, userId));
    const [row] = await systemDb.select().from(users).where(eq(users.id, userId));
    expect(row).toMatchObject({ fullName: 'Renamed', locale: 'en', passwordHash: 'x' });
  });

  it('cannot create a platform admin', async () => {
    const msg = await rejectionMessage(
      db
        .insert(users)
        .values({ email: `rogue-${run}@example.com`, fullName: 'Rogue', isPlatformAdmin: true }),
    );
    expect(msg).toMatch(/is_platform_admin cannot be set by gym_app/);
  });

  it('cannot promote an account to platform admin', async () => {
    const msg = await rejectionMessage(
      db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, userId)),
    );
    expect(msg).toMatch(/permission denied for table users/);
    const [row] = await systemDb.select().from(users).where(eq(users.id, userId));
    expect(row?.isPlatformAdmin).toBe(false);
  });

  it('cannot delete accounts', async () => {
    const msg = await rejectionMessage(db.delete(users).where(eq(users.id, userId)));
    expect(msg).toMatch(/permission denied for table users/);
  });

  it('can rename its own gym but cannot change its id', async () => {
    await withGym(gymId, (tx) =>
      tx
        .update(gyms)
        .set({ name: `Renamed ${run}` })
        .where(eq(gyms.id, gymId)),
    );
    const msg = await rejectionMessage(
      withGym(gymId, (tx) => tx.update(gyms).set({ id: randomUUID() }).where(eq(gyms.id, gymId))),
    );
    expect(msg).toMatch(/permission denied for table gyms/);
    const [row] = await systemDb.select({ name: gyms.name }).from(gyms).where(eq(gyms.id, gymId));
    expect(row?.name).toBe(`Renamed ${run}`);
  });
});

describe('row-level security catalog guard', () => {
  it('every gym-owned table (gyms, or any table with gym_id) has RLS enabled, forced and a policy', async () => {
    const { rows } = await systemDb.execute<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind in ('r', 'p') -- ordinary and partitioned tables
        and (c.relname = 'gyms' or exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'gym_id' and not a.attisdropped))
      order by c.relname`);

    expect(rows.map((r) => r.table)).toEqual(
      expect.arrayContaining(['gym_roles', 'gyms', 'invitations']),
    );
    for (const row of rows) {
      expect(row, row.table).toMatchObject({ enabled: true, forced: true });
      expect(row.policies, row.table).toBeGreaterThan(0);
    }
  });
});
