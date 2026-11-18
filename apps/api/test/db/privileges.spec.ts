import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import { gymRoles, gyms, users } from '../../src/db/schema';
import { withGym } from '../../src/db/tenant';
import { ownerDb } from './owner-db';

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
      .values({ email: `priv-${run}@example.com`, firstName: 'Plain', lastName: 'User' })
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

  it('cannot create accounts (users are written only through systemDb)', async () => {
    const msg = await rejectionMessage(
      db
        .insert(users)
        .values({ email: `new-${run}@example.com`, firstName: 'Μαρία', lastName: 'Νέα' }),
    );
    expect(msg).toMatch(/permission denied for table users/);
  });

  it('cannot change a name or password hash, even of a user in its own gym', async () => {
    await systemDb.insert(gymRoles).values({ gymId, userId, role: 'member' });
    try {
      // The user is visible under RLS, so a rejection here is the missing UPDATE grant.
      const visible = await withGym(gymId, (tx) =>
        tx.select({ id: users.id }).from(users).where(eq(users.id, userId)),
      );
      expect(visible).toHaveLength(1);
      for (const set of [
        { firstName: 'Renamed', lastName: 'Test' },
        { passwordHash: 'x' },
        { locale: 'en' },
      ]) {
        const msg = await rejectionMessage(
          withGym(gymId, (tx) => tx.update(users).set(set).where(eq(users.id, userId))),
        );
        expect(msg).toMatch(/permission denied for table users/);
      }
      const [row] = await systemDb.select().from(users).where(eq(users.id, userId));
      expect(row).toMatchObject({
        firstName: 'Plain',
        lastName: 'User',
        passwordHash: null,
        locale: 'el',
      });
    } finally {
      await systemDb.delete(gymRoles).where(eq(gymRoles.userId, userId));
    }
  });

  it('holds no column-level write grant on users left over from 0001', async () => {
    const { rows } = await systemDb.execute<{ col: string; ins: boolean; upd: boolean }>(sql`
      select c as col,
             has_column_privilege('gym_app', 'users', c, 'INSERT') as ins,
             has_column_privilege('gym_app', 'users', c, 'UPDATE') as upd
      from unnest(array['email', 'password_hash', 'full_name', 'locale']) as c`);
    expect(rows.filter((r) => r.ins || r.upd)).toEqual([]);
  });

  it('reads personal details of a gym member but never the password hash or admin flag', async () => {
    await systemDb.insert(gymRoles).values({ gymId, userId, role: 'member' });
    try {
      const rows = await withGym(gymId, (tx) =>
        tx
          .select({ phone: users.phone, dob: users.dateOfBirth, name: users.fullName })
          .from(users)
          .where(eq(users.id, userId)),
      );
      expect(rows).toHaveLength(1);
      for (const col of [users.passwordHash, users.isPlatformAdmin]) {
        const msg = await rejectionMessage(
          withGym(gymId, (tx) => tx.select({ c: col }).from(users).where(eq(users.id, userId))),
        );
        expect(msg).toMatch(/permission denied for table users/);
      }
    } finally {
      await systemDb.delete(gymRoles).where(eq(gymRoles.userId, userId));
    }
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

describe('gym_system privileges (systemDb)', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let userId: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Sys A ${run}` }, { name: `Sys B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const [u] = await systemDb
      .insert(users)
      .values({ email: `sys-${run}@example.com`, firstName: 'Sys', lastName: 'User' })
      .returning({ id: users.id });
    userId = u!.id;
    await systemDb.insert(gymRoles).values([
      { gymId: gymA, userId, role: 'member' },
      { gymId: gymB, userId, role: 'member' },
    ]);
  });

  afterAll(async () => {
    await systemDb.delete(gymRoles).where(eq(gymRoles.userId, userId));
    await systemDb.delete(users).where(eq(users.id, userId));
    await systemDb.delete(gyms).where(sql`${gyms.id} in (${gymA}, ${gymB})`);
  });

  it('connects as gym_system, which bypasses RLS but is not a superuser', async () => {
    const { rows } = await systemDb.execute<{ role: string; bypass: boolean; superuser: boolean }>(
      sql`select current_user as role, rolbypassrls as bypass, rolsuper as superuser
          from pg_roles where rolname = current_user`,
    );
    expect(rows).toEqual([{ role: 'gym_system', bypass: true, superuser: false }]);
  });

  it('reads gym_roles across gyms', async () => {
    const rows = await systemDb.select().from(gymRoles).where(eq(gymRoles.userId, userId));
    expect(rows.map((r) => r.gymId).sort()).toEqual([gymA, gymB].sort());
  });

  it('can insert, update and delete users (every users write goes through it)', async () => {
    const email = `sysw-${run}@example.com`;
    const [created] = await systemDb
      .insert(users)
      .values({ email, firstName: 'Writer', lastName: 'Test' })
      .returning({ id: users.id });
    await systemDb
      .update(users)
      .set({ firstName: 'Writer', lastName: '2' })
      .where(eq(users.id, created!.id));
    const [row] = await systemDb.select().from(users).where(eq(users.id, created!.id));
    expect(row?.fullName).toBe('Writer 2');
    await systemDb.delete(users).where(eq(users.id, created!.id));
    expect(await systemDb.select().from(users).where(eq(users.id, created!.id))).toEqual([]);
  });

  it('cannot create tables', async () => {
    const msg = await rejectionMessage(systemDb.execute(sql`create table zz_sys_probe (id int)`));
    expect(msg).toMatch(/permission denied for schema public/);
  });

  it('cannot alter or drop existing tables', async () => {
    expect(
      await rejectionMessage(systemDb.execute(sql`alter table users add column zz int`)),
    ).toMatch(/must be owner of table users/);
    expect(await rejectionMessage(systemDb.execute(sql`drop table gym_roles`))).toMatch(
      /must be owner of table gym_roles/,
    );
  });
});

/**
 * Every gym-owned table (gyms, or any table with gym_id) must have RLS enabled and forced, at least
 * one policy, and every permissive policy must tie the gym column to app.gym_id in both USING and WITH CHECK
 * (restrictive ones only narrow access and are skipped).
 * Returns one line per problem.
 */
async function rlsProblems(): Promise<string[]> {
  const { rows } = await systemDb.execute<{
    table: string;
    enabled: boolean;
    forced: boolean;
    policies:
      { name: string; permissive: string; qual: string | null; check: string | null }[] | null;
  }>(sql`
    select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
           (select json_agg(json_build_object('name', p.policyname, 'permissive', p.permissive, 'qual', p.qual,
                                              'check', p.with_check))
              from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r', 'p') -- ordinary and partitioned tables
      and (c.relname = 'gyms' or exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'gym_id' and not a.attisdropped))
    order by c.relname`);

  const problems: string[] = [];
  for (const t of rows) {
    if (!t.enabled || !t.forced) problems.push(`${t.table}: RLS not enabled and forced`);
    if (!t.policies?.length) problems.push(`${t.table}: no policy`);
    const column = t.table === 'gyms' ? 'id' : 'gym_id';
    // Postgres stores the expression normalised:
    // (gym_id = (NULLIF(current_setting('app.gym_id'::text, true), ''::text))::uuid)
    const expected = `(${column} = (NULLIF(current_setting('app.gym_id'::text, true), ''::text))::uuid)`;
    for (const p of t.policies ?? []) {
      // A RESTRICTIVE policy is ANDed with the permissive ones, so it can only narrow access.
      if (p.permissive === 'RESTRICTIVE') continue;
      if (p.qual !== expected || p.check !== expected) {
        problems.push(`${t.table}.${p.name}: USING/WITH CHECK not tied to app.gym_id`);
      }
    }
  }
  return problems;
}

describe('row-level security catalog guard', () => {
  it('every gym-owned table has forced RLS and only policies tied to app.gym_id', async () => {
    expect(await rlsProblems()).toEqual([]);
  });

  it('flags a gym table whose policy lets everything through', async () => {
    // DDL needs the owner role; systemDb (gym_system) may not create tables.
    const owner = ownerDb();
    await owner.execute(sql`create table zz_rls_probe (gym_id uuid not null)`);
    try {
      await owner.execute(sql`alter table zz_rls_probe enable row level security`);
      await owner.execute(sql`alter table zz_rls_probe force row level security`);
      await owner.execute(
        sql`create policy open on zz_rls_probe for all using (true) with check (true)`,
      );
      expect(await rlsProblems()).toEqual([
        'zz_rls_probe.open: USING/WITH CHECK not tied to app.gym_id',
      ]);
    } finally {
      await owner.execute(sql`drop table zz_rls_probe`);
      await owner.$client.end();
    }
  });
});
