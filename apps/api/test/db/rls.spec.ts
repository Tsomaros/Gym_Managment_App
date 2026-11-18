import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import {
  auditLog,
  bodyMeasurements,
  healthConsents,
  checkIns,
  devicePairingCodes,
  devices,
  exercises,
  gymRoles,
  gyms,
  invitations,
  memberPhotos,
  memberTrainers,
  membershipFreezes,
  memberships,
  membershipTypes,
  payments,
  notificationPrefs,
  notificationsSent,
  progressPhotos,
  pushSubscriptions,
  planDays,
  planExercises,
  plans,
  shiftSeries,
  trainerCovers,
  shifts,
  signupCodes,
  workoutSessions,
  workoutSets,
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

describe('row-level security and privileges: devices and device_pairing_codes', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let deviceA: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Dev A ${run}` }, { name: `Dev B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const expiresAt = new Date(Date.now() + 900_000);
    const d = await systemDb
      .insert(devices)
      .values([
        { gymId: gymA, name: 'A', tokenHash: `a-${randomUUID()}` },
        { gymId: gymB, name: 'B', tokenHash: `b-${randomUUID()}` },
      ])
      .returning({ id: devices.id });
    deviceA = d[0]!.id;
    await systemDb.insert(devicePairingCodes).values([
      { gymId: gymA, name: 'A', codeHash: `a-${randomUUID()}`, expiresAt },
      { gymId: gymB, name: 'B', codeHash: `b-${randomUUID()}`, expiresAt },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(devices).where(inArray(devices.gymId, gymIds));
      await systemDb.delete(devicePairingCodes).where(inArray(devicePairingCodes.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
  });

  it('withGym(A) sees only gym A devices and pairing codes', async () => {
    const d = await withGym(gymA, (tx) => tx.select().from(devices));
    const c = await withGym(gymA, (tx) => tx.select().from(devicePairingCodes));
    expect(d.map((r) => r.gymId)).toEqual([gymA]);
    expect(c.map((r) => r.gymId)).toEqual([gymA]);
  });

  it('sees nothing when no gym is set', async () => {
    expect(await db.select().from(devices)).toEqual([]);
    expect(await db.select().from(devicePairingCodes)).toEqual([]);
  });

  it('withGym(A) cannot create a pairing code for gym B', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.insert(devicePairingCodes).values({
          gymId: gymB,
          name: 'x',
          codeHash: `x-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 900_000),
        }),
      ),
    );
    expect(msg).toMatch(RLS_VIOLATION);
  });

  it('gym_app can revoke its own devices but not rename them or revoke gym B devices', async () => {
    const revoked = await withGym(gymA, (tx) =>
      tx
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(eq(devices.id, deviceA))
        .returning({ id: devices.id }),
    );
    expect(revoked).toHaveLength(1);
    const other = await withGym(gymA, (tx) =>
      tx
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(eq(devices.gymId, gymB))
        .returning({ id: devices.id }),
    );
    expect(other).toEqual([]);
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.update(devices).set({ name: 'renamed' }).where(eq(devices.id, deviceA)),
      ),
    );
    expect(msg).toMatch(/permission denied/);
  });

  it('gym_app cannot delete devices or touch pairing codes beyond creating them', async () => {
    const del = await rejectionMessage(
      withGym(gymA, (tx) => tx.delete(devices).where(eq(devices.id, deviceA))),
    );
    expect(del).toMatch(/permission denied/);
    const upd = await rejectionMessage(
      withGym(gymA, (tx) => tx.update(devicePairingCodes).set({ usedAt: new Date() })),
    );
    expect(upd).toMatch(/permission denied/);
    const delCode = await rejectionMessage(withGym(gymA, (tx) => tx.delete(devicePairingCodes)));
    expect(delCode).toMatch(/permission denied/);
    // nothing was lost
    expect(await systemDb.select().from(devices).where(eq(devices.id, deviceA))).toHaveLength(1);
  });

  it('gym_app cannot create devices (pairing goes through systemDb)', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.insert(devices).values({ gymId: gymA, name: 'x', tokenHash: `x-${randomUUID()}` }),
      ),
    );
    expect(msg).toMatch(/permission denied/);
  });
});

describe('row-level security and privileges: check_ins', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let rowA: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Check A ${run}` }, { name: `Check B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `ca-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `cb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    memberA = u[0]!.id;
    memberB = u[1]!.id;
    const rows = await systemDb
      .insert(checkIns)
      .values([
        { gymId: gymA, memberId: memberA, method: 'manual', valid: true },
        { gymId: gymB, memberId: memberB, method: 'manual', valid: true },
      ])
      .returning({ id: checkIns.id });
    rowA = rows[0]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(checkIns).where(inArray(checkIns.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(inArray(users.id, [memberA, memberB].filter(Boolean)));
  });

  it('withGym(A) sees only gym A check-ins; without a gym nothing is visible', async () => {
    const rows = await withGym(gymA, (tx) => tx.select().from(checkIns));
    expect(rows.map((r) => r.gymId)).toEqual([gymA]);
    expect(await db.select().from(checkIns)).toEqual([]);
  });

  it('withGym(A) cannot record a check-in for gym B', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx
          .insert(checkIns)
          .values({ gymId: gymB, memberId: memberB, method: 'manual', valid: true }),
      ),
    );
    expect(msg).toMatch(RLS_VIOLATION);
  });

  it('withGym(A) cannot check out a gym B visitor', async () => {
    const out = await withGym(gymA, (tx) =>
      tx
        .update(checkIns)
        .set({ checkedOutAt: new Date() })
        .where(eq(checkIns.memberId, memberB))
        .returning({ id: checkIns.id }),
    );
    expect(out).toEqual([]);
    const [rowB] = await systemDb.select().from(checkIns).where(eq(checkIns.memberId, memberB));
    expect(rowB!.checkedOutAt).toBeNull();
  });

  it('a valid check-in must have no reason and an invalid one must have one', async () => {
    const bad = (valid: boolean, reason: string | null) =>
      rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(checkIns)
            .values({ gymId: gymA, memberId: memberA, method: 'manual', valid, reason }),
        ),
      );
    expect(await bad(true, 'expired')).toMatch(/check_ins_reason_matches_valid/);
    expect(await bad(false, null)).toMatch(/check_ins_reason_matches_valid/);
  });

  it('a kiosk check-in needs a device, and a consumed visit needs a valid check-in with a membership', async () => {
    const insert = (v: Partial<typeof checkIns.$inferInsert>) =>
      rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(checkIns)
            .values({ gymId: gymA, memberId: memberA, method: 'manual', valid: true, ...v }),
        ),
      );
    expect(await insert({ method: 'kiosk' })).toMatch(/check_ins_kiosk_has_device/);
    expect(await insert({ visitConsumed: true })).toMatch(/check_ins_visit_consumed_valid/);
    expect(await insert({ visitConsumed: true, valid: false, reason: 'used_up' })).toMatch(
      /check_ins_visit_consumed_valid/,
    );
  });

  it('gym_app can check a visitor out but cannot change anything else or delete', async () => {
    const out = await withGym(gymA, (tx) =>
      tx
        .update(checkIns)
        .set({ checkedOutAt: new Date() })
        .where(eq(checkIns.id, rowA))
        .returning({ id: checkIns.id }),
    );
    expect(out).toHaveLength(1);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(checkIns).set({ valid: false, reason: 'expired' }).where(eq(checkIns.id, rowA)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) => tx.delete(checkIns).where(eq(checkIns.id, rowA))),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('row-level security and privileges: member_photos', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Photo A ${run}` }, { name: `Photo B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `pa-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `pb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    memberA = u[0]!.id;
    memberB = u[1]!.id;
    await systemDb.insert(memberPhotos).values([
      { gymId: gymA, memberId: memberA, objectKey: `gyms/${gymA}/members/${memberA}/a.jpg` },
      { gymId: gymB, memberId: memberB, objectKey: `gyms/${gymB}/members/${memberB}/b.jpg` },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(memberPhotos).where(inArray(memberPhotos.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(inArray(users.id, [memberA, memberB].filter(Boolean)));
  });

  it('withGym(A) sees only gym A photos; without a gym nothing is visible', async () => {
    const rows = await withGym(gymA, (tx) => tx.select().from(memberPhotos));
    expect(rows.map((r) => r.gymId)).toEqual([gymA]);
    expect(await db.select().from(memberPhotos)).toEqual([]);
  });

  it('withGym(A) cannot add, change or delete a gym B photo', async () => {
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.insert(memberPhotos).values({ gymId: gymB, memberId: memberB, objectKey: 'x' }),
      ),
    );
    expect(msg).toMatch(RLS_VIOLATION);
    const updated = await withGym(gymA, (tx) =>
      tx
        .update(memberPhotos)
        .set({ objectKey: 'hijacked' })
        .where(eq(memberPhotos.memberId, memberB))
        .returning({ id: memberPhotos.memberId }),
    );
    expect(updated).toEqual([]);
    const deleted = await withGym(gymA, (tx) =>
      tx
        .delete(memberPhotos)
        .where(eq(memberPhotos.memberId, memberB))
        .returning({ id: memberPhotos.memberId }),
    );
    expect(deleted).toEqual([]);
    const [still] = await systemDb
      .select()
      .from(memberPhotos)
      .where(eq(memberPhotos.memberId, memberB));
    expect(still!.objectKey).toContain('b.jpg');
  });

  it('gym_app can replace and remove its own gym photo, but not move it to another member or gym', async () => {
    const replaced = await withGym(gymA, (tx) =>
      tx
        .update(memberPhotos)
        .set({ objectKey: 'new-key', updatedAt: new Date() })
        .where(eq(memberPhotos.memberId, memberA))
        .returning({ key: memberPhotos.objectKey }),
    );
    expect(replaced).toEqual([{ key: 'new-key' }]);
    const msg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx
          .update(memberPhotos)
          .set({ memberId: memberB })
          .where(eq(memberPhotos.memberId, memberA)),
      ),
    );
    expect(msg).toMatch(/permission denied/);
    // Moving the row to another gym is a column gym_app may not update (the policy alone would not stop it for gym B).
    const moveMsg = await rejectionMessage(
      withGym(gymA, (tx) =>
        tx.update(memberPhotos).set({ gymId: gymB }).where(eq(memberPhotos.memberId, memberA)),
      ),
    );
    expect(moveMsg).toMatch(/permission denied/);
    // With no gym set, writing is refused too, not only reading.
    expect(
      await rejectionMessage(
        db.insert(memberPhotos).values({ gymId: gymA, memberId: memberB, objectKey: 'x' }),
      ),
    ).toMatch(RLS_VIOLATION);
    const removed = await withGym(gymA, (tx) =>
      tx
        .delete(memberPhotos)
        .where(eq(memberPhotos.memberId, memberA))
        .returning({ id: memberPhotos.memberId }),
    );
    expect(removed).toHaveLength(1);
  });
});

describe('row-level security and privileges: shift_series and shifts', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let staffA: string;
  let staffB: string;
  let seriesA: string;
  let seriesB: string;
  let shiftB: string;
  let shiftA: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Shift A ${run}` }, { name: `Shift B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `sa-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `sb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    staffA = u[0]!.id;
    staffB = u[1]!.id;
    const series = await systemDb
      .insert(shiftSeries)
      .values([
        {
          gymId: gymA,
          staffId: staffA,
          weekday: 1,
          startsAt: '06:00',
          endsAt: '14:00',
          validFrom: '2027-05-03',
        },
        {
          gymId: gymB,
          staffId: staffB,
          weekday: 1,
          startsAt: '06:00',
          endsAt: '14:00',
          validFrom: '2027-05-03',
        },
      ])
      .returning({ id: shiftSeries.id });
    seriesA = series[0]!.id;
    seriesB = series[1]!.id;
    const s = await systemDb
      .insert(shifts)
      .values([
        { gymId: gymB, staffId: staffB, date: '2027-05-05', startsAt: '09:00', endsAt: '12:00' },
        { gymId: gymA, staffId: staffA, date: '2027-05-05', startsAt: '09:00', endsAt: '12:00' },
      ])
      .returning({ id: shifts.id });
    shiftB = s[0]!.id;
    shiftA = s[1]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(shifts).where(inArray(shifts.gymId, gymIds));
      await systemDb.delete(shiftSeries).where(inArray(shiftSeries.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(inArray(users.id, [staffA, staffB].filter(Boolean)));
  });

  it('withGym(A) sees only gym A series and shifts; without a gym nothing is visible', async () => {
    expect(
      (await withGym(gymA, (tx) => tx.select().from(shiftSeries))).map((r) => r.gymId),
    ).toEqual([gymA]);
    expect((await withGym(gymA, (tx) => tx.select().from(shifts))).map((r) => r.id)).toEqual([
      shiftA,
    ]);
    // and the same from gym B's side
    expect((await withGym(gymB, (tx) => tx.select().from(shiftSeries))).map((r) => r.id)).toEqual([
      seriesB,
    ]);
    expect((await withGym(gymB, (tx) => tx.select().from(shifts))).map((r) => r.id)).toEqual([
      shiftB,
    ]);
    expect(await db.select().from(shiftSeries)).toEqual([]);
    expect(await db.select().from(shifts)).toEqual([]);
  });

  it('with no gym set, inserting is refused too', async () => {
    expect(
      await rejectionMessage(
        db.insert(shiftSeries).values({
          gymId: gymA,
          staffId: staffA,
          weekday: 3,
          startsAt: '06:00',
          endsAt: '07:00',
          validFrom: '2027-05-05',
        }),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await rejectionMessage(
        db.insert(shifts).values({
          gymId: gymA,
          staffId: staffA,
          date: '2027-05-06',
          startsAt: '09:00',
          endsAt: '10:00',
        }),
      ),
    ).toMatch(RLS_VIOLATION);
  });

  it('withGym(A) cannot add rows for gym B, nor change or delete gym B rows', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(shiftSeries).values({
            gymId: gymB,
            staffId: staffB,
            weekday: 2,
            startsAt: '06:00',
            endsAt: '07:00',
            validFrom: '2027-05-04',
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(shifts).values({
            gymId: gymB,
            staffId: staffB,
            date: '2027-05-06',
            startsAt: '09:00',
            endsAt: '10:00',
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    const ended = await withGym(gymA, (tx) =>
      tx
        .update(shiftSeries)
        .set({ validUntil: '2027-05-09' })
        .where(eq(shiftSeries.id, seriesB))
        .returning({ id: shiftSeries.id }),
    );
    expect(ended).toEqual([]);
    const changed = await withGym(gymA, (tx) =>
      tx
        .update(shifts)
        .set({ cancelled: true })
        .where(eq(shifts.id, shiftB))
        .returning({ id: shifts.id }),
    );
    expect(changed).toEqual([]);
    expect(
      await withGym(gymA, (tx) =>
        tx.delete(shifts).where(eq(shifts.id, shiftB)).returning({ id: shifts.id }),
      ),
    ).toEqual([]);
    expect(
      await withGym(gymA, (tx) =>
        tx.delete(shiftSeries).where(eq(shiftSeries.id, seriesB)).returning({ id: shiftSeries.id }),
      ),
    ).toEqual([]);
    const [still] = await systemDb.select().from(shifts).where(eq(shifts.id, shiftB));
    expect(still!.cancelled).toBe(false);
    const [stillSeries] = await systemDb
      .select()
      .from(shiftSeries)
      .where(eq(shiftSeries.id, seriesB));
    expect(stillSeries!.validUntil).toBeNull();
  });

  it("refuses an override that points at another gym or another person's series", async () => {
    // gym A override of gym B's series: same-gym foreign key
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(shifts).values({
            gymId: gymA,
            staffId: staffA,
            date: '2027-05-10',
            startsAt: '09:00',
            endsAt: '10:00',
            seriesId: seriesB,
          }),
        ),
      ),
    ).toMatch(/foreign key/);
    // same gym, but another staff member than the series belongs to
    expect(
      await rejectionMessage(
        systemDb.insert(shifts).values({
          gymId: gymA,
          staffId: staffB,
          date: '2027-05-10',
          startsAt: '09:00',
          endsAt: '10:00',
          seriesId: seriesA,
        }),
      ),
    ).toMatch(/foreign key/);
  });

  it('gym_app can end a series but not change who or when it runs', async () => {
    const ended = await withGym(gymA, (tx) =>
      tx
        .update(shiftSeries)
        .set({ validUntil: '2027-05-09' })
        .where(eq(shiftSeries.id, seriesA))
        .returning({ validUntil: shiftSeries.validUntil }),
    );
    expect(ended).toEqual([{ validUntil: '2027-05-09' }]);
    // a one-off's day, person and gym are fixed too; its hours may change
    for (const change of [{ date: '2027-05-06' }, { staffId: staffB }, { gymId: gymB }]) {
      expect(
        await rejectionMessage(
          withGym(gymA, (tx) => tx.update(shifts).set(change).where(eq(shifts.id, shiftA))),
        ),
      ).toMatch(/permission denied/);
    }
    const hours = await withGym(gymA, (tx) =>
      tx
        .update(shifts)
        .set({ endsAt: '13:00' })
        .where(eq(shifts.id, shiftA))
        .returning({ endsAt: shifts.endsAt }),
    );
    expect(hours).toHaveLength(1);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(shiftSeries).set({ weekday: 2 }).where(eq(shiftSeries.id, seriesA)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(shiftSeries).set({ staffId: staffB }).where(eq(shiftSeries.id, seriesA)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(shiftSeries).set({ startsAt: '01:00' }).where(eq(shiftSeries.id, seriesA)),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('row-level security and privileges: member_trainers', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let trainerA: string;
  let trainerB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Trainer A ${run}` }, { name: `Trainer B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values(
        ['ma', 'mb', 'ta', 'tb'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'X',
        })),
      )
      .returning({ id: users.id });
    [memberA, memberB, trainerA, trainerB] = u.map((r) => r.id) as [string, string, string, string];
    await systemDb.insert(memberTrainers).values([
      { gymId: gymA, memberId: memberA, trainerId: trainerA },
      { gymId: gymB, memberId: memberB, trainerId: trainerB },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(memberTrainers).where(inArray(memberTrainers.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb
      .delete(users)
      .where(inArray(users.id, [memberA, memberB, trainerA, trainerB].filter(Boolean)));
  });

  it('withGym(A) sees only gym A links; without a gym nothing is visible', async () => {
    const rows = await withGym(gymA, (tx) => tx.select().from(memberTrainers));
    expect(rows.map((r) => r.gymId)).toEqual([gymA]);
    expect(await db.select().from(memberTrainers)).toEqual([]);
  });

  it('withGym(A) cannot add, change or delete a gym B link', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(memberTrainers).values({ gymId: gymB, memberId: memberA, trainerId: trainerB }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    const changed = await withGym(gymA, (tx) =>
      tx
        .update(memberTrainers)
        .set({ trainerId: trainerA })
        .where(eq(memberTrainers.memberId, memberB))
        .returning({ id: memberTrainers.memberId }),
    );
    expect(changed).toEqual([]);
    const deleted = await withGym(gymA, (tx) =>
      tx
        .delete(memberTrainers)
        .where(eq(memberTrainers.memberId, memberB))
        .returning({ id: memberTrainers.memberId }),
    );
    expect(deleted).toEqual([]);
    const [still] = await systemDb
      .select()
      .from(memberTrainers)
      .where(eq(memberTrainers.memberId, memberB));
    expect(still!.trainerId).toBe(trainerB);
  });

  it('gym_app can replace the trainer of its own link but not move it to another member', async () => {
    const replaced = await withGym(gymA, (tx) =>
      tx
        .update(memberTrainers)
        .set({ trainerId: trainerB })
        .where(eq(memberTrainers.memberId, memberA))
        .returning({ trainerId: memberTrainers.trainerId }),
    );
    expect(replaced).toEqual([{ trainerId: trainerB }]);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .update(memberTrainers)
            .set({ memberId: memberB })
            .where(eq(memberTrainers.memberId, memberA)),
        ),
      ),
    ).toMatch(/permission denied/);
    // nor move the link to another gym
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .update(memberTrainers)
            .set({ gymId: gymB })
            .where(eq(memberTrainers.memberId, memberA)),
        ),
      ),
    ).toMatch(/permission denied/);
    const [row] = await systemDb
      .select()
      .from(memberTrainers)
      .where(eq(memberTrainers.memberId, memberA));
    expect(row).toMatchObject({ gymId: gymA, memberId: memberA, trainerId: trainerB });
  });
});

describe('row-level security and privileges: trainer_covers', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let trainerA: string;
  let trainerB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Cover A ${run}` }, { name: `Cover B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values(
        ['cma', 'cmb', 'cta', 'ctb'].map((n) => ({
          email: `${n}-${run}@x.gr`,
          firstName: n,
          lastName: 'X',
        })),
      )
      .returning({ id: users.id });
    [memberA, memberB, trainerA, trainerB] = u.map((r) => r.id) as [string, string, string, string];
    await systemDb.insert(trainerCovers).values([
      { gymId: gymA, memberId: memberA, trainerId: trainerA, date: '2027-05-12' },
      { gymId: gymB, memberId: memberB, trainerId: trainerB, date: '2027-05-12' },
    ]);
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(trainerCovers).where(inArray(trainerCovers.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb
      .delete(users)
      .where(inArray(users.id, [memberA, memberB, trainerA, trainerB].filter(Boolean)));
  });

  it('withGym(A) sees only gym A covers; without a gym nothing is visible', async () => {
    const rows = await withGym(gymA, (tx) => tx.select().from(trainerCovers));
    expect(rows.map((r) => r.gymId)).toEqual([gymA]);
    expect(
      (await withGym(gymB, (tx) => tx.select().from(trainerCovers))).map((r) => r.gymId),
    ).toEqual([gymB]);
    expect(await db.select().from(trainerCovers)).toEqual([]);
  });

  it('withGym(A) cannot add, change or delete a gym B cover', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(trainerCovers).values({
            gymId: gymB,
            memberId: memberA,
            trainerId: trainerB,
            date: '2027-05-13',
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await withGym(gymA, (tx) =>
        tx
          .update(trainerCovers)
          .set({ trainerId: trainerA })
          .where(eq(trainerCovers.memberId, memberB))
          .returning({ id: trainerCovers.id }),
      ),
    ).toEqual([]);
    expect(
      await withGym(gymA, (tx) =>
        tx
          .delete(trainerCovers)
          .where(eq(trainerCovers.memberId, memberB))
          .returning({ id: trainerCovers.id }),
      ),
    ).toEqual([]);
    const [still] = await systemDb
      .select()
      .from(trainerCovers)
      .where(eq(trainerCovers.memberId, memberB));
    expect(still!.trainerId).toBe(trainerB);
  });

  it('allows one cover per member and date, and gym_app cannot move a cover to another date', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(trainerCovers).values({
            gymId: gymA,
            memberId: memberA,
            trainerId: trainerB,
            date: '2027-05-12',
          }),
        ),
      ),
    ).toMatch(/duplicate key|unique/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .update(trainerCovers)
            .set({ date: '2027-05-20' })
            .where(eq(trainerCovers.memberId, memberA)),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('gym_app can replace the trainer of its own cover but not move it to another member or gym', async () => {
    const replaced = await withGym(gymA, (tx) =>
      tx
        .update(trainerCovers)
        .set({ trainerId: trainerB })
        .where(eq(trainerCovers.memberId, memberA))
        .returning({ trainerId: trainerCovers.trainerId }),
    );
    expect(replaced).toEqual([{ trainerId: trainerB }]);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .update(trainerCovers)
            .set({ memberId: memberB })
            .where(eq(trainerCovers.memberId, memberA)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(trainerCovers).set({ gymId: gymB }).where(eq(trainerCovers.memberId, memberA)),
        ),
      ),
    ).toMatch(/permission denied/);
    const [row] = await systemDb
      .select()
      .from(trainerCovers)
      .where(eq(trainerCovers.memberId, memberA));
    expect(row).toMatchObject({ gymId: gymA, memberId: memberA, trainerId: trainerB });
  });
});

describe('row-level security and privileges: exercises', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let exA: string;
  let exB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Ex A ${run}` }, { name: `Ex B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const rows = await systemDb
      .insert(exercises)
      .values([
        { gymId: gymA, nameEl: 'Πιέσεις', muscleGroup: 'chest', measure: 'weight_reps' },
        { gymId: gymB, nameEl: 'Πιέσεις', muscleGroup: 'chest', measure: 'weight_reps' },
      ])
      .returning({ id: exercises.id });
    exA = rows[0]!.id;
    exB = rows[1]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(exercises).where(inArray(exercises.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
  });

  it('withGym(A) sees only gym A exercises; without a gym nothing is visible', async () => {
    expect((await withGym(gymA, (tx) => tx.select().from(exercises))).map((r) => r.id)).toEqual([
      exA,
    ]);
    expect((await withGym(gymB, (tx) => tx.select().from(exercises))).map((r) => r.id)).toEqual([
      exB,
    ]);
    expect(await db.select().from(exercises)).toEqual([]);
  });

  it('withGym(A) cannot add, change or archive a gym B exercise', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(exercises)
            .values({ gymId: gymB, nameEl: 'Άλλο', muscleGroup: 'core', measure: 'reps' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await withGym(gymA, (tx) =>
        tx
          .update(exercises)
          .set({ archivedAt: new Date() })
          .where(eq(exercises.id, exB))
          .returning({ id: exercises.id }),
      ),
    ).toEqual([]);
    const [still] = await systemDb.select().from(exercises).where(eq(exercises.id, exB));
    expect(still!.archivedAt).toBeNull();
  });

  it('the same Greek name may exist in two gyms but not twice in one, whatever the case', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(exercises)
            .values({ gymId: gymA, nameEl: 'πιέσεις', muscleGroup: 'core', measure: 'reps' }),
        ),
      ),
    ).toMatch(/duplicate key|unique/);
  });

  it('gym_app can neither delete an exercise nor change its gym or creator', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) => tx.delete(exercises).where(eq(exercises.id, exA))),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(exercises).set({ gymId: gymB }).where(eq(exercises.id, exA)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.update(exercises).set({ createdBy: randomUUID() }).where(eq(exercises.id, exA)),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('withGym(A) can archive its own exercise (the grant is not too narrow)', async () => {
    const [own] = await withGym(gymA, (tx) =>
      tx
        .insert(exercises)
        .values({ gymId: gymA, nameEl: 'Δική μας', muscleGroup: 'core', measure: 'reps' })
        .returning({ id: exercises.id }),
    );
    const done = await withGym(gymA, (tx) =>
      tx
        .update(exercises)
        .set({ archivedAt: new Date() })
        .where(eq(exercises.id, own!.id))
        .returning({ id: exercises.id }),
    );
    expect(done).toHaveLength(1);
  });

  it('rejects a blank Greek name', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(exercises)
            .values({ gymId: gymA, nameEl: '   ', muscleGroup: 'core', measure: 'reps' }),
        ),
      ),
    ).toMatch(/check constraint/);
  });

  it('rejects an unknown muscle group or measure', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(exercises)
            .values({ gymId: gymA, nameEl: 'Χ1', muscleGroup: 'wings', measure: 'reps' }),
        ),
      ),
    ).toMatch(/check constraint/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(exercises)
            .values({ gymId: gymA, nameEl: 'Χ2', muscleGroup: 'core', measure: 'miles' }),
        ),
      ),
    ).toMatch(/check constraint/);
  });
});

describe('row-level security and privileges: workout_sessions and workout_sets', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let sessA: string;
  let sessB: string;
  let setA: string;
  let exA: string;
  let exB: string;
  const started = new Date('2027-05-12T08:00:00Z');
  const set = (gymId: string, sessionId: string, exerciseId: string, setIndex: number) => ({
    gymId,
    sessionId,
    exerciseId,
    measure: 'weight_reps',
    setIndex,
    reps: 5,
    weightKg: '50',
    done: true,
    loggedAt: started,
  });

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Wo A ${run}` }, { name: `Wo B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `wa-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `wb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    memberA = u[0]!.id;
    memberB = u[1]!.id;
    const ex = await systemDb
      .insert(exercises)
      .values([
        { gymId: gymA, nameEl: 'Πιέσεις', muscleGroup: 'chest', measure: 'weight_reps' },
        { gymId: gymB, nameEl: 'Πιέσεις', muscleGroup: 'chest', measure: 'weight_reps' },
      ])
      .returning({ id: exercises.id });
    exA = ex[0]!.id;
    exB = ex[1]!.id;
    const s = await systemDb
      .insert(workoutSessions)
      .values([
        { gymId: gymA, memberId: memberA, startedAt: started },
        { gymId: gymB, memberId: memberB, startedAt: started },
      ])
      .returning({ id: workoutSessions.id });
    sessA = s[0]!.id;
    sessB = s[1]!.id;
    const st = await systemDb
      .insert(workoutSets)
      .values([set(gymA, sessA, exA, 0), set(gymB, sessB, exB, 0)])
      .returning({ id: workoutSets.id });
    setA = st[0]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(workoutSets).where(inArray(workoutSets.gymId, gymIds));
      await systemDb.delete(workoutSessions).where(inArray(workoutSessions.gymId, gymIds));
      await systemDb.delete(plans).where(inArray(plans.gymId, gymIds));
      await systemDb.delete(exercises).where(inArray(exercises.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`w_-${run}@x.gr`}`);
  });

  it('withGym(A) sees only gym A sessions and sets; without a gym nothing is visible', async () => {
    const sessions = (g: string) => withGym(g, (tx) => tx.select().from(workoutSessions));
    expect((await sessions(gymA)).map((r) => r.id)).toEqual([sessA]);
    expect((await sessions(gymB)).map((r) => r.id)).toEqual([sessB]);
    expect((await withGym(gymA, (tx) => tx.select().from(workoutSets))).map((r) => r.id)).toEqual([
      setA,
    ]);
    expect(await db.select().from(workoutSessions)).toEqual([]);
    expect(await db.select().from(workoutSets)).toEqual([]);
  });

  it('withGym(A) cannot write a gym B row, nor change or delete one', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(workoutSessions).values({ gymId: gymB, memberId: memberB, startedAt: started }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) => tx.insert(workoutSets).values(set(gymB, sessB, exB, 1))),
      ),
    ).toMatch(RLS_VIOLATION);
    const changed = await withGym(gymA, (tx) =>
      tx
        .update(workoutSets)
        .set({ reps: 99 })
        .where(eq(workoutSets.gymId, gymB))
        .returning({ id: workoutSets.id }),
    );
    expect(changed).toEqual([]);
    const removed = await withGym(gymA, (tx) =>
      tx.delete(workoutSets).where(eq(workoutSets.gymId, gymB)).returning({ id: workoutSets.id }),
    );
    expect(removed).toEqual([]);
    const [intact] = await systemDb.select().from(workoutSets).where(eq(workoutSets.gymId, gymB));
    expect(intact!.reps).toBe(5);
  });

  it('a set cannot point at a session or exercise of another gym (composite foreign keys)', async () => {
    expect(
      await rejectionMessage(systemDb.insert(workoutSets).values(set(gymA, sessB, exA, 7))),
    ).toMatch(/foreign key/);
    expect(
      await rejectionMessage(systemDb.insert(workoutSets).values(set(gymA, sessA, exB, 7))),
    ).toMatch(/foreign key/);
  });

  it('gym_app cannot delete sessions, change identity columns, or break the value checks', async () => {
    const as = (fn: Parameters<typeof withGym>[1]) => rejectionMessage(withGym(gymA, fn));
    expect(
      await as((tx) => tx.delete(workoutSessions).where(eq(workoutSessions.id, sessA))),
    ).toMatch(/permission denied/);
    expect(
      await as((tx) =>
        tx.update(workoutSessions).set({ memberId: memberB }).where(eq(workoutSessions.id, sessA)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await as((tx) =>
        tx.update(workoutSets).set({ exerciseId: exA }).where(eq(workoutSets.id, setA)),
      ),
    ).toMatch(/permission denied/);
    // weight off the 0.25 grid, a done set with 0 reps, and a weight_reps set carrying a duration
    for (const bad of [{ weightKg: '20.30' }, { reps: 0 }, { durationSeconds: 30 }]) {
      expect(
        await as((tx) => tx.update(workoutSets).set(bad).where(eq(workoutSets.id, setA))),
      ).toMatch(/check constraint/);
    }
  });

  it('deleting a plan keeps the session and its sets and nulls only the link, never the gym', async () => {
    const [plan] = await systemDb
      .insert(plans)
      .values({ gymId: gymA, memberId: memberA, kind: 'interactive', title: 'P', status: 'draft' })
      .returning({ id: plans.id });
    const [day] = await systemDb
      .insert(planDays)
      .values({ gymId: gymA, planId: plan!.id, position: 0, title: 'D' })
      .returning({ id: planDays.id });
    const [pe] = await systemDb
      .insert(planExercises)
      .values({ gymId: gymA, planDayId: day!.id, exerciseId: exA, position: 0, sets: 3 })
      .returning({ id: planExercises.id });
    const [sess] = await systemDb
      .insert(workoutSessions)
      .values({
        gymId: gymA,
        memberId: memberA,
        startedAt: started,
        planId: plan!.id,
        planDayId: day!.id,
      })
      .returning({ id: workoutSessions.id });
    const [row] = await systemDb
      .insert(workoutSets)
      .values({ ...set(gymA, sess!.id, exA, 3), planExerciseId: pe!.id })
      .returning({ id: workoutSets.id });
    await systemDb.delete(plans).where(eq(plans.id, plan!.id));
    const [s2] = await systemDb
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sess!.id));
    expect(s2).toMatchObject({ gymId: gymA, planId: null, planDayId: null });
    const [t2] = await systemDb.select().from(workoutSets).where(eq(workoutSets.id, row!.id));
    expect(t2).toMatchObject({ gymId: gymA, planExerciseId: null });
  });
});

describe('row-level security and privileges: health_consents and body_measurements', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let consentA: string;
  let consentB: string;
  let measA: string;
  let measB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `He A ${run}` }, { name: `He B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `ha-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `hb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    memberA = u[0]!.id;
    memberB = u[1]!.id;
    const c = await systemDb
      .insert(healthConsents)
      .values([
        { gymId: gymA, memberId: memberA, kind: 'measurements', textVersion: 'v1' },
        { gymId: gymB, memberId: memberB, kind: 'measurements', textVersion: 'v1' },
      ])
      .returning({ id: healthConsents.id });
    consentA = c[0]!.id;
    consentB = c[1]!.id;
    const m = await systemDb
      .insert(bodyMeasurements)
      .values([
        { gymId: gymA, memberId: memberA, measuredOn: '2027-05-12', weightKg: '80' },
        { gymId: gymB, memberId: memberB, measuredOn: '2027-05-12', weightKg: '70' },
      ])
      .returning({ id: bodyMeasurements.id });
    measA = m[0]!.id;
    measB = m[1]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(bodyMeasurements).where(inArray(bodyMeasurements.gymId, gymIds));
      await systemDb.delete(healthConsents).where(inArray(healthConsents.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`h_-${run}@x.gr`}`);
  });

  it('withGym(A) sees only gym A rows in both tables; without a gym nothing is visible', async () => {
    const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);
    expect(ids(await withGym(gymA, (tx) => tx.select().from(healthConsents)))).toEqual([consentA]);
    expect(ids(await withGym(gymB, (tx) => tx.select().from(healthConsents)))).toEqual([consentB]);
    expect(ids(await withGym(gymA, (tx) => tx.select().from(bodyMeasurements)))).toEqual([measA]);
    expect(ids(await withGym(gymB, (tx) => tx.select().from(bodyMeasurements)))).toEqual([measB]);
    expect(await db.select().from(healthConsents)).toEqual([]);
    expect(await db.select().from(bodyMeasurements)).toEqual([]);
  });

  it('withGym(A) cannot write, change or delete gym B rows', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(healthConsents)
            .values({ gymId: gymB, memberId: memberB, kind: 'photos', textVersion: 'v1' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(bodyMeasurements)
            .values({ gymId: gymB, memberId: memberB, measuredOn: '2027-05-12', weightKg: '70' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    const withdrawn = await withGym(gymA, (tx) =>
      tx
        .update(healthConsents)
        .set({ withdrawnAt: new Date() })
        .where(eq(healthConsents.gymId, gymB))
        .returning({ id: healthConsents.id }),
    );
    expect(withdrawn).toEqual([]);
    const removed = await withGym(gymA, (tx) =>
      tx
        .delete(bodyMeasurements)
        .where(eq(bodyMeasurements.gymId, gymB))
        .returning({ id: bodyMeasurements.id }),
    );
    expect(removed).toEqual([]);
    expect(
      await systemDb.select().from(bodyMeasurements).where(eq(bodyMeasurements.id, measB)),
    ).toHaveLength(1);
  });

  it('gym_app cannot delete a consent, change a measurement, or give one member two active consents', async () => {
    const as = (fn: Parameters<typeof withGym>[1]) => rejectionMessage(withGym(gymA, fn));
    expect(
      await as((tx) => tx.delete(healthConsents).where(eq(healthConsents.id, consentA))),
    ).toMatch(/permission denied/);
    expect(
      await as((tx) =>
        tx.update(healthConsents).set({ kind: 'photos' }).where(eq(healthConsents.id, consentA)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await as((tx) =>
        tx.update(bodyMeasurements).set({ weightKg: '1' }).where(eq(bodyMeasurements.id, measA)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await as((tx) =>
        tx
          .insert(healthConsents)
          .values({ gymId: gymA, memberId: memberA, kind: 'measurements', textVersion: 'v1' }),
      ),
    ).toMatch(/duplicate key/);
    // another kind is fine
    await withGym(gymA, (tx) =>
      tx
        .insert(healthConsents)
        .values({ gymId: gymA, memberId: memberA, kind: 'photos', textVersion: 'v1' }),
    );
  });

  it('allows one active consent per gym for the same person, and a re-grant after a withdrawal', async () => {
    // the same person in gym B: a second active 'measurements' consent is not a duplicate
    await withGym(gymB, (tx) =>
      tx
        .insert(healthConsents)
        .values({ gymId: gymB, memberId: memberA, kind: 'measurements', textVersion: 'v1' }),
    );
    // withdraw gym B's own consent, then grant again: the old row stays, the new one is active
    await withGym(gymB, (tx) =>
      tx
        .update(healthConsents)
        .set({ withdrawnAt: new Date() })
        .where(eq(healthConsents.id, consentB)),
    );
    await withGym(gymB, (tx) =>
      tx
        .insert(healthConsents)
        .values({ gymId: gymB, memberId: memberB, kind: 'measurements', textVersion: 'v1' }),
    );
    const rows = await withGym(gymB, (tx) =>
      tx.select().from(healthConsents).where(eq(healthConsents.memberId, memberB)),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.withdrawnAt === null)).toHaveLength(1);
  });

  it('rejects out-of-range values, an empty measurement, an unknown kind and a backdated withdrawal', async () => {
    const insert = (values: Partial<typeof bodyMeasurements.$inferInsert>) =>
      rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(bodyMeasurements)
            .values({ gymId: gymA, memberId: memberA, measuredOn: '2027-05-12', ...values }),
        ),
      );
    for (const bad of [
      { weightKg: '19.99' },
      { weightKg: '400.01' },
      { bodyFatPct: '1.9' },
      { bodyFatPct: '70.1' },
      { waistCm: '9.9' },
      { thighCm: '300.1' },
      { weightKg: '80', notes: 'x'.repeat(301) },
      {}, // no value at all
    ]) {
      expect(await insert(bad)).toMatch(/check constraint/);
    }
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(healthConsents)
            .values({ gymId: gymA, memberId: memberA, kind: 'dna', textVersion: 'v1' }),
        ),
      ),
    ).toMatch(/check constraint/);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .update(healthConsents)
            .set({ withdrawnAt: new Date('2000-01-01') })
            .where(eq(healthConsents.id, consentA)),
        ),
      ),
    ).toMatch(/check constraint/);
  });
});

describe('row-level security and privileges: progress_photos', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let photoA: string;
  let photoB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Ph A ${run}` }, { name: `Ph B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `pa-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `pb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    memberA = u[0]!.id;
    memberB = u[1]!.id;
    const p = await systemDb
      .insert(progressPhotos)
      .values([
        { gymId: gymA, memberId: memberA, takenOn: '2027-05-12', objectKey: `k-a-${run}` },
        { gymId: gymB, memberId: memberB, takenOn: '2027-05-12', objectKey: `k-b-${run}` },
      ])
      .returning({ id: progressPhotos.id });
    photoA = p[0]!.id;
    photoB = p[1]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(progressPhotos).where(inArray(progressPhotos.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(sql`${users.email} like ${`p_-${run}@x.gr`}`);
  });

  it('withGym(A) sees only gym A photos; without a gym nothing is visible', async () => {
    const ids = (g: string) =>
      withGym(g, (tx) => tx.select().from(progressPhotos)).then((r) => r.map((x) => x.id));
    expect(await ids(gymA)).toEqual([photoA]);
    expect(await ids(gymB)).toEqual([photoB]);
    expect(await db.select().from(progressPhotos)).toEqual([]);
  });

  it('withGym(A) cannot add, change or delete a gym B photo, and nobody can edit a row', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(progressPhotos).values({
            gymId: gymB,
            memberId: memberB,
            takenOn: '2027-05-12',
            objectKey: `x-${run}`,
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    const removed = await withGym(gymA, (tx) =>
      tx
        .delete(progressPhotos)
        .where(eq(progressPhotos.gymId, gymB))
        .returning({ id: progressPhotos.id }),
    );
    expect(removed).toEqual([]);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .update(progressPhotos)
            .set({ takenOn: '2020-01-01' })
            .where(eq(progressPhotos.id, photoA)),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('without a gym nothing can be added, and a gym can add and delete its own photo', async () => {
    expect(
      await rejectionMessage(
        db
          .insert(progressPhotos)
          .values({ gymId: gymA, memberId: memberA, takenOn: '2027-05-12', objectKey: `n-${run}` }),
      ),
    ).toMatch(RLS_VIOLATION);
    const [own] = await withGym(gymA, (tx) =>
      tx
        .insert(progressPhotos)
        .values({ gymId: gymA, memberId: memberA, takenOn: '2027-05-12', objectKey: `o-${run}` })
        .returning({ id: progressPhotos.id }),
    );
    const removed = await withGym(gymA, (tx) =>
      tx
        .delete(progressPhotos)
        .where(eq(progressPhotos.id, own!.id))
        .returning({ id: progressPhotos.id }),
    );
    expect(removed).toEqual([{ id: own!.id }]);
  });

  it('rejects an empty or duplicate object key', async () => {
    const insert = (objectKey: string) =>
      rejectionMessage(
        withGym(gymA, (tx) =>
          tx
            .insert(progressPhotos)
            .values({ gymId: gymA, memberId: memberA, takenOn: '2027-05-12', objectKey }),
        ),
      );
    expect(await insert('')).toMatch(/check constraint/);
    expect(await insert(`k-a-${run}`)).toMatch(/duplicate key/);
  });
});

describe('row-level security and privileges: notifications', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Nt A ${run}` }, { name: `Nt B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values([
        { email: `na-${run}@x.gr`, firstName: 'A', lastName: 'A' },
        { email: `nb-${run}@x.gr`, firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id });
    memberA = u[0]!.id;
    memberB = u[1]!.id;
    await systemDb.insert(notificationPrefs).values([
      { gymId: gymA, userId: memberA, group: 'membership', email: false },
      { gymId: gymB, userId: memberB, group: 'membership' },
    ]);
    await systemDb.insert(notificationsSent).values([
      {
        gymId: gymA,
        userId: memberA,
        event: 'plan.assigned',
        dedupeKey: `k-${run}`,
        channels: ['email'],
      },
      {
        gymId: gymB,
        userId: memberB,
        event: 'plan.assigned',
        dedupeKey: `k-${run}`,
        channels: ['push'],
      },
    ]);
  });

  afterAll(async () => {
    // Deleting the gyms and users cascades to prefs, sent records and subscriptions.
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    await systemDb.delete(users).where(sql`${users.email} like ${`n_-${run}@x.gr`}`);
  });

  it('withGym(A) sees only gym A prefs and sent records; without a gym nothing is visible', async () => {
    const prefs = await withGym(gymA, (tx) => tx.select().from(notificationPrefs));
    expect(prefs.map((p) => p.userId)).toEqual([memberA]);
    const sent = await withGym(gymA, (tx) => tx.select().from(notificationsSent));
    expect(sent.map((p) => p.userId)).toEqual([memberA]);
    expect(await db.select().from(notificationPrefs)).toEqual([]);
    expect(await db.select().from(notificationsSent)).toEqual([]);
  });

  it('the same dedupe key is allowed in two gyms but not twice in one', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(notificationsSent).values({
            gymId: gymA,
            userId: memberA,
            event: 'plan.assigned',
            dedupeKey: `k-${run}`,
            channels: ['push'],
          }),
        ),
      ),
    ).toMatch(/unique/);
  });

  it('withGym(A) cannot write gym B rows, and sent records cannot be edited or deleted', async () => {
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(notificationPrefs).values({ gymId: gymB, userId: memberB, group: 'plans' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) =>
          tx.insert(notificationsSent).values({
            gymId: gymB,
            userId: memberB,
            event: 'plan.assigned',
            dedupeKey: `z-${run}`,
            channels: ['push'],
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION);
    const changed = await withGym(gymA, (tx) =>
      tx
        .update(notificationPrefs)
        .set({ email: false })
        .where(eq(notificationPrefs.gymId, gymB))
        .returning({ u: notificationPrefs.userId }),
    );
    expect(changed).toEqual([]);
    expect(
      await rejectionMessage(
        withGym(gymA, (tx) => tx.update(notificationsSent).set({ channels: ['push'] })),
      ),
    ).toMatch(/permission denied/);
    expect(await rejectionMessage(withGym(gymA, (tx) => tx.delete(notificationsSent)))).toMatch(
      /permission denied/,
    );
  });

  it('push subscriptions are global: gym_app cannot touch them, and deleting the user removes them', async () => {
    await systemDb
      .insert(pushSubscriptions)
      .values({ userId: memberA, endpoint: `https://push.example/${run}`, p256dh: 'p', auth: 'a' });
    expect(
      await rejectionMessage(withGym(gymA, (tx) => tx.select().from(pushSubscriptions))),
    ).toMatch(/permission denied/);
    await systemDb.delete(users).where(eq(users.id, memberA));
    expect(
      await systemDb.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, memberA)),
    ).toEqual([]);
  });
});
