import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import {
  auditLog,
  gymRoles,
  gyms,
  invitations,
  membershipFreezes,
  memberships,
  membershipTypes,
  payments,
  signupCodes,
  users,
} from '../../src/db/schema';
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

// Once, after every describe in this file: the pools are shared.
afterAll(async () => {
  await closeDb();
});

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

describe('row-level security: signup_codes', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Codes A ${run}` }, { name: `Codes B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const expiresAt = new Date(Date.now() + 3600_000);
    await systemDb.insert(signupCodes).values([
      { gymId: gymA, codeHash: `a-${randomUUID()}`, expiresAt },
      { gymId: gymB, codeHash: `b-${randomUUID()}`, expiresAt },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(signupCodes).where(inArray(signupCodes.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
  });

  it('withGym(A) sees only gym A codes', async () => {
    const rows = await withGym(gymA, (tx) => tx.select().from(signupCodes));
    expect(rows.map((r) => r.gymId)).toEqual([gymA]);
  });

  it('withGym(A) cannot create a code for gym B', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.insert(signupCodes).values({
          gymId: gymB,
          codeHash: `x-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3600_000),
        }),
      ),
    );
    expect(msg).toMatch(RLS_VIOLATION);
  });

  it('sees no codes when no gym is set', async () => {
    expect(await db.select().from(signupCodes)).toEqual([]);
  });
});

describe('row-level security and privileges: audit_log', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Audit A ${run}` }, { name: `Audit B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    await systemDb.insert(auditLog).values([
      { gymId: gymA, action: 'signup_code.issued', entity: 'signup_code' },
      { gymId: gymB, action: 'signup_code.issued', entity: 'signup_code' },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(auditLog).where(inArray(auditLog.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
  });

  it('withGym(A) sees only gym A entries', async () => {
    const rows = await withGym(gymA, (tx) => tx.select().from(auditLog));
    expect(rows.map((r) => r.gymId)).toEqual([gymA]);
    const rowsB = await withGym(gymB, (tx) => tx.select().from(auditLog));
    expect(rowsB.length).toBeGreaterThanOrEqual(1);
    expect(rowsB.every((r) => r.gymId === gymB)).toBe(true);
  });

  it('withGym(A) can append to its own history but not to gym B', async () => {
    await withGym(gymA, (tx) =>
      tx.insert(auditLog).values({ gymId: gymA, action: 'freeze.created', entity: 'freeze' }),
    );
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.insert(auditLog).values({ gymId: gymB, action: 'freeze.created', entity: 'freeze' }),
      ),
    );
    expect(msg).toMatch(RLS_VIOLATION);
  });

  it('entries cannot be edited or deleted by gym_app, even in its own gym', async () => {
    const upd = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.update(auditLog).set({ action: 'x' }).where(eq(auditLog.gymId, gymA)),
      ),
    );
    expect(upd).toMatch(/permission denied/);
    const del = await rejectionMessage(
      withGym(gymA, (tx) => tx.delete(auditLog).where(eq(auditLog.gymId, gymA))),
    );
    expect(del).toMatch(/permission denied/);
  });

  it('sees no entries when no gym is set', async () => {
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe('row-level security: membership_types', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `MT A ${run}` }, { name: `MT B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    await systemDb.insert(membershipTypes).values([
      { gymId: gymA, name: 'A', kind: 'day_pass', priceCents: 1000 },
      { gymId: gymB, name: 'B', kind: 'day_pass', priceCents: 1000 },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(membershipTypes).where(inArray(membershipTypes.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
  });

  it('each gym sees only its own types', async () => {
    const a = await withGym(gymA, (tx) => tx.select().from(membershipTypes));
    const b = await withGym(gymB, (tx) => tx.select().from(membershipTypes));
    expect(a.map((r) => r.name)).toEqual(['A']);
    expect(b.map((r) => r.name)).toEqual(['B']);
  });

  it('withGym(A) cannot create a type for gym B or move one there', async () => {
    const insert = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx
          .insert(membershipTypes)
          .values({ gymId: gymB, name: 'X', kind: 'day_pass', priceCents: 1 }),
      ),
    );
    expect(insert).toMatch(RLS_VIOLATION);
    const move = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.update(membershipTypes).set({ gymId: gymB }).where(eq(membershipTypes.gymId, gymA)),
      ),
    );
    expect(move).toMatch(RLS_VIOLATION);
  });

  it('the database enforces the kind rules too', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.insert(membershipTypes).values({
          gymId: gymA,
          name: 'Bad',
          kind: 'visits',
          visitCount: 10,
          maxFreezeDays: 5,
          priceCents: 1,
        }),
      ),
    );
    expect(msg).toMatch(/violates check constraint/);
  });
});

describe('row-level security: memberships and payments', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let member: string;
  let typeA: string;
  let typeB: string;
  let membershipA: string;
  let membershipB: string;

  const membership = (gymId: string, typeId: string) => ({
    gymId,
    memberId: member,
    typeId,
    name: 'Ημερήσια',
    kind: 'day_pass' as const,
    priceCents: 800,
    startsOn: '2027-01-31',
    baseEndsOn: '2027-01-31',
    endsOn: '2027-01-31',
    visitsTotal: 1,
    createdBy: member,
  });

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `MP A ${run}` }, { name: `MP B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const [u] = await systemDb
      .insert(users)
      .values({ email: `mp-${run}@example.com`, firstName: 'Μέλος', lastName: 'Δύο γυμναστηρίων' })
      .returning({ id: users.id });
    member = u!.id;
    const t = await systemDb
      .insert(membershipTypes)
      .values([
        { gymId: gymA, name: 'A', kind: 'day_pass', priceCents: 800 },
        { gymId: gymB, name: 'B', kind: 'day_pass', priceCents: 800 },
      ])
      .returning({ id: membershipTypes.id });
    typeA = t[0]!.id;
    typeB = t[1]!.id;
    const m = await systemDb
      .insert(memberships)
      .values([membership(gymA, typeA), membership(gymB, typeB)])
      .returning({ id: memberships.id });
    membershipA = m[0]!.id;
    membershipB = m[1]!.id;
    await systemDb.insert(payments).values([
      {
        gymId: gymA,
        membershipId: membershipA,
        memberId: member,
        amountCents: 800,
        method: 'cash',
        recordedBy: member,
      },
      {
        gymId: gymB,
        membershipId: membershipB,
        memberId: member,
        amountCents: 800,
        method: 'card',
        recordedBy: member,
      },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(payments).where(inArray(payments.gymId, gymIds));
      await systemDb.delete(memberships).where(inArray(memberships.gymId, gymIds));
      await systemDb.delete(membershipTypes).where(inArray(membershipTypes.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    if (member) await systemDb.delete(users).where(eq(users.id, member));
  });

  it('each gym sees only its own memberships and payments', async () => {
    const a = await withGym(gymA, async (tx) => ({
      m: await tx.select().from(memberships),
      p: await tx.select().from(payments),
    }));
    const b = await withGym(gymB, async (tx) => ({
      m: await tx.select().from(memberships),
      p: await tx.select().from(payments),
    }));
    expect(a.m.map((r) => r.id)).toEqual([membershipA]);
    expect(a.p.map((r) => r.method)).toEqual(['cash']);
    expect(b.m.map((r) => r.id)).toEqual([membershipB]);
    expect(b.p.map((r) => r.method)).toEqual(['card']);
    expect(await db.select().from(payments)).toEqual([]);
  });

  it('withGym(A) cannot write a membership or payment for gym B', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) => tx.insert(memberships).values(membership(gymB, typeB))),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(payments).values({
            gymId: gymB,
            membershipId: membershipB,
            memberId: member,
            amountCents: 1,
            method: 'cash',
            recordedBy: member,
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
  });

  it('a membership of gym A cannot point at a type of gym B, even through systemDb', async () => {
    expect(
      await rejectionMessage(systemDb.insert(memberships).values(membership(gymA, typeB))),
    ).toMatch(/violates foreign key constraint/);
  });

  it('a payment of gym A cannot point at a membership of gym B, even through systemDb', async () => {
    expect(
      await rejectionMessage(
        systemDb.insert(payments).values({
          gymId: gymA,
          membershipId: membershipB,
          memberId: member,
          amountCents: 1,
          method: 'cash',
          recordedBy: member,
        }),
      ),
    ).toMatch(/violates foreign key constraint/);
  });

  it('gym_app cannot delete payments or change their amount', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) => tx.delete(payments).where(eq(payments.gymId, gymA))),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(payments).set({ amountCents: 1 }).where(eq(payments.gymId, gymA)),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('a voided payment or membership cannot be un-voided', async () => {
    // Gym B's rows, so gym A's stay unvoided for the void-reason test below.
    await withGym(gymB, (tx) =>
      tx
        .update(payments)
        .set({ voidedAt: new Date(), voidedBy: member, voidReason: 'test' })
        .where(eq(payments.gymId, gymB)),
    );
    await withGym(gymB, (tx) =>
      tx.update(memberships).set({ voidedAt: new Date() }).where(eq(memberships.gymId, gymB)),
    );
    expect(
      await rejectionMessage(
        withGym(gymB, (tx) =>
          tx
            .update(payments)
            .set({ voidedAt: null, voidedBy: null, voidReason: null })
            .where(eq(payments.gymId, gymB)),
        ),
      ),
    ).toMatch(/cannot be un-voided/);
    expect(
      await rejectionMessage(
        withGym(gymB, (tx) =>
          tx.update(memberships).set({ voidedAt: null }).where(eq(memberships.gymId, gymB)),
        ),
      ),
    ).toMatch(/cannot be un-voided/);
  });

  it('the database requires a void reason exactly when a payment is voided', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(payments).set({ voidedAt: new Date() }).where(eq(payments.gymId, gymA)),
        ),
      ),
    ).toMatch(/violates check constraint/);
  });
});

describe('row-level security: membership_freezes', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let member: string;
  const membershipOf: Record<string, string> = {};

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `FR A ${run}` }, { name: `FR B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const [u] = await systemDb
      .insert(users)
      .values({ email: `fr-${run}@example.com`, firstName: 'Μέλος', lastName: 'Παγώματος' })
      .returning({ id: users.id });
    member = u!.id;
    for (const gymId of [gymA, gymB]) {
      const [t] = await systemDb
        .insert(membershipTypes)
        .values({
          gymId,
          name: 'M',
          kind: 'time',
          durationMonths: 1,
          priceCents: 1,
          maxFreezeDays: 14,
        })
        .returning({ id: membershipTypes.id });
      const [m] = await systemDb
        .insert(memberships)
        .values({
          gymId,
          memberId: member,
          typeId: t!.id,
          name: 'M',
          kind: 'time',
          priceCents: 1,
          maxFreezeDays: 14,
          startsOn: '2027-05-01',
          baseEndsOn: '2027-05-31',
          endsOn: '2027-05-31',
        })
        .returning({ id: memberships.id });
      membershipOf[gymId] = m!.id;
      await systemDb.insert(membershipFreezes).values({
        gymId,
        membershipId: m!.id,
        startsOn: '2027-05-10',
        endsOn: '2027-05-12',
      });
    }
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(membershipFreezes).where(inArray(membershipFreezes.gymId, gymIds));
      await systemDb.delete(memberships).where(inArray(memberships.gymId, gymIds));
      await systemDb.delete(membershipTypes).where(inArray(membershipTypes.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    if (member) await systemDb.delete(users).where(eq(users.id, member));
  });

  it('each gym sees only its own freezes', async () => {
    const a = await withGym(gymA, (tx) => tx.select().from(membershipFreezes));
    const b = await withGym(gymB, (tx) => tx.select().from(membershipFreezes));
    expect(a.map((r) => r.membershipId)).toEqual([membershipOf[gymA]]);
    expect(b.map((r) => r.membershipId)).toEqual([membershipOf[gymB]]);
  });

  it('withGym(A) cannot add a freeze to gym B, nor delete one there', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(membershipFreezes).values({
            gymId: gymB,
            membershipId: membershipOf[gymB]!,
            startsOn: '2027-05-20',
            endsOn: '2027-05-21',
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    await withGym(gymA, (tx) =>
      tx.delete(membershipFreezes).where(eq(membershipFreezes.gymId, gymB)),
    );
    expect(
      await systemDb.select().from(membershipFreezes).where(eq(membershipFreezes.gymId, gymB)),
    ).toHaveLength(1);
  });

  it('a freeze of gym A cannot point at a membership of gym B, even through systemDb', async () => {
    expect(
      await rejectionMessage(
        systemDb.insert(membershipFreezes).values({
          gymId: gymA,
          membershipId: membershipOf[gymB]!,
          startsOn: '2027-05-20',
          endsOn: '2027-05-21',
        }),
      ),
    ).toMatch(/violates foreign key constraint/);
  });

  it('the database refuses a freeze that ends before it starts', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(membershipFreezes).values({
            gymId: gymA,
            membershipId: membershipOf[gymA]!,
            startsOn: '2027-05-20',
            endsOn: '2027-05-19',
          }),
        ),
      ),
    ).toMatch(/violates check constraint/);
  });
});
