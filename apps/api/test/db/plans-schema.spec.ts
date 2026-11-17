import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db, systemDb } from '../../src/db/client';
import { exercises, gyms, planDays, planExercises, plans, users } from '../../src/db/schema';
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
const UNIQUE = /duplicate key|unique/;

describe('plans, plan_days and plan_exercises', () => {
  const run = randomUUID().slice(0, 8);
  let gymA: string;
  let gymB: string;
  let memberA: string;
  let memberB: string;
  let exA: string;
  let exB: string;

  const plan = (over: Partial<typeof plans.$inferInsert> = {}) => ({
    // Status and timestamps go together (plans_status_ts_chk).
    ...(over.status === 'active' && { activatedAt: new Date() }),
    ...(over.status === 'archived' && { archivedAt: new Date() }),
    gymId: gymA,
    memberId: memberA,
    kind: 'interactive',
    title: 'Πρόγραμμα',
    status: 'draft',
    isTemplate: false,
    ...over,
  });
  const newPlan = async (over: Partial<typeof plans.$inferInsert> = {}) =>
    (await systemDb.insert(plans).values(plan(over)).returning({ id: plans.id }))[0]!.id;
  const newDay = async (planId: string, position: number, gym = gymA) =>
    (
      await systemDb
        .insert(planDays)
        .values({ gymId: gym, planId, position, title: `Ημέρα ${position}` })
        .returning({ id: planDays.id })
    )[0]!.id;
  const exRow = (dayId: string, over: Partial<typeof planExercises.$inferInsert> = {}) => ({
    gymId: gymA,
    planDayId: dayId,
    exerciseId: exA,
    position: 1,
    sets: 3,
    repsMin: 8,
    repsMax: 10,
    ...over,
  });

  beforeAll(async () => {
    const g = await systemDb
      .insert(gyms)
      .values([{ name: `Plans A ${run}` }, { name: `Plans B ${run}` }])
      .returning({ id: gyms.id });
    gymA = g[0]!.id;
    gymB = g[1]!.id;
    const u = await systemDb
      .insert(users)
      .values(
        ['pma', 'pmb'].map((n) => ({ email: `${n}-${run}@x.gr`, firstName: n, lastName: 'X' })),
      )
      .returning({ id: users.id });
    [memberA, memberB] = u.map((r) => r.id) as [string, string];
    const e = await systemDb
      .insert(exercises)
      .values([
        { gymId: gymA, nameEl: 'Α', muscleGroup: 'chest', measure: 'weight_reps' },
        { gymId: gymB, nameEl: 'Α', muscleGroup: 'chest', measure: 'weight_reps' },
      ])
      .returning({ id: exercises.id });
    exA = e[0]!.id;
    exB = e[1]!.id;
  });

  afterAll(async () => {
    const gymIds = [gymA, gymB].filter(Boolean);
    if (gymIds.length) {
      await systemDb.delete(plans).where(inArray(plans.gymId, gymIds)); // days and exercises cascade
      await systemDb.delete(exercises).where(inArray(exercises.gymId, gymIds));
      await systemDb.delete(gyms).where(inArray(gyms.id, gymIds));
    }
    await systemDb.delete(users).where(inArray(users.id, [memberA, memberB].filter(Boolean)));
    await closeDb();
  });

  describe('plans', () => {
    it('a template with a member rejects, and so does a non-template without one', async () => {
      expect(
        await rejectionMessage(systemDb.insert(plans).values(plan({ isTemplate: true }))),
      ).toMatch(/plans_template_chk/);
      expect(
        await rejectionMessage(systemDb.insert(plans).values(plan({ memberId: null }))),
      ).toMatch(/plans_template_chk/);
      await systemDb.insert(plans).values(plan({ isTemplate: true, memberId: null }));
    });

    it('a PDF template or an active template rejects', async () => {
      // The PDF row carries a key, so only the template/kind rule (not the key rule) can reject it.
      expect(
        await rejectionMessage(
          systemDb
            .insert(plans)
            .values(
              plan({ isTemplate: true, memberId: null, kind: 'pdf', pdfObjectKey: 'k/t.pdf' }),
            ),
        ),
      ).toMatch(/plans_template_kind_chk/);
      expect(
        await rejectionMessage(
          systemDb
            .insert(plans)
            .values(plan({ isTemplate: true, memberId: null, status: 'active' })),
        ),
      ).toMatch(/plans_template_status_chk/);
    });

    it('a PDF plan needs a file key, and an interactive plan must not have one', async () => {
      expect(await rejectionMessage(systemDb.insert(plans).values(plan({ kind: 'pdf' })))).toMatch(
        /plans_pdf_key_chk/,
      );
      expect(
        await rejectionMessage(systemDb.insert(plans).values(plan({ pdfObjectKey: 'k/a.pdf' }))),
      ).toMatch(/plans_pdf_key_chk/);
      await systemDb.insert(plans).values(plan({ kind: 'pdf', pdfObjectKey: 'k/a.pdf' }));
    });

    it('rejects an empty or over-long title and over-long notes', async () => {
      for (const over of [{ title: '' }, { title: 'x'.repeat(81) }]) {
        expect(await rejectionMessage(systemDb.insert(plans).values(plan(over)))).toMatch(
          /plans_title_chk/,
        );
      }
      expect(
        await rejectionMessage(systemDb.insert(plans).values(plan({ notes: 'x'.repeat(1001) }))),
      ).toMatch(/plans_notes_chk/);
      const id = await newPlan({ title: 'x'.repeat(80), notes: 'x'.repeat(1000) });
      expect(id).toBeTruthy();
    });

    it('ties status to its timestamps: archived needs archived_at, active needs activated_at', async () => {
      const row = plan();
      expect(
        await rejectionMessage(systemDb.insert(plans).values({ ...row, status: 'archived' })),
      ).toMatch(/plans_status_ts_chk/);
      expect(
        await rejectionMessage(systemDb.insert(plans).values({ ...row, status: 'active' })),
      ).toMatch(/plans_status_ts_chk/);
      expect(
        await rejectionMessage(
          systemDb.insert(plans).values({ ...row, status: 'draft', archivedAt: new Date() }),
        ),
      ).toMatch(/plans_status_ts_chk/);
    });

    it('rejects an unknown kind or status', async () => {
      expect(
        await rejectionMessage(systemDb.insert(plans).values(plan({ kind: 'video' }))),
      ).toMatch(/plans_kind_chk/);
      expect(
        await rejectionMessage(systemDb.insert(plans).values(plan({ status: 'paused' }))),
      ).toMatch(/plans_status_chk/);
    });

    it('two active plans for one member reject; draft and archived ones may pile up', async () => {
      const member = (
        await systemDb
          .insert(users)
          .values({ email: `pmc-${run}@x.gr`, firstName: 'pmc', lastName: 'X' })
          .returning({ id: users.id })
      )[0]!.id;
      try {
        await newPlan({ memberId: member, status: 'active' });
        expect(await rejectionMessage(newPlan({ memberId: member, status: 'active' }))).toMatch(
          UNIQUE,
        );
        await newPlan({ memberId: member, status: 'draft' });
        await newPlan({ memberId: member, status: 'draft' });
        await newPlan({ memberId: member, status: 'archived' });
        await newPlan({ memberId: member, status: 'archived' });
        // Another member of the same gym is unaffected.
        await newPlan({ memberId: memberA, status: 'active' });
      } finally {
        await systemDb.delete(plans).where(eq(plans.memberId, member));
        await systemDb.delete(plans).where(eq(plans.memberId, memberA));
        await systemDb.delete(users).where(eq(users.id, member));
      }
    });
  });

  describe('plan_days', () => {
    it('swapping the positions of two days inside one transaction succeeds', async () => {
      const planId = await newPlan();
      const d1 = await newDay(planId, 1);
      const d2 = await newDay(planId, 2);
      await systemDb.transaction(async (tx) => {
        await tx.update(planDays).set({ position: 2 }).where(eq(planDays.id, d1));
        await tx.update(planDays).set({ position: 1 }).where(eq(planDays.id, d2));
      });
      const rows = await systemDb.select().from(planDays).where(eq(planDays.planId, planId));
      expect(rows.find((r) => r.id === d1)!.position).toBe(2);
      expect(rows.find((r) => r.id === d2)!.position).toBe(1);
    });

    it('a day needs a title of 1–80 characters and a position of 0–13', async () => {
      const planId = await newPlan();
      const row = { gymId: gymA, planId, position: 0, title: 'Α' };
      expect(
        await rejectionMessage(systemDb.insert(planDays).values({ ...row, title: '' })),
      ).toMatch(/plan_days_title_chk/);
      expect(
        await rejectionMessage(systemDb.insert(planDays).values({ ...row, title: 'x'.repeat(81) })),
      ).toMatch(/plan_days_title_chk/);
      expect(
        await rejectionMessage(systemDb.insert(planDays).values({ ...row, position: -1 })),
      ).toMatch(/plan_days_position_chk/);
      expect(
        await rejectionMessage(systemDb.insert(planDays).values({ ...row, position: 14 })),
      ).toMatch(/plan_days_position_chk/);
      await systemDb.insert(planDays).values({ ...row, position: 13 });
      await systemDb.insert(planDays).values(row);
    });

    it('the same position twice in one plan rejects at commit', async () => {
      const planId = await newPlan();
      await newDay(planId, 1);
      expect(await rejectionMessage(newDay(planId, 1))).toMatch(UNIQUE);
    });

    it('a day cannot point at a plan of another gym', async () => {
      const planId = await newPlan();
      expect(await rejectionMessage(newDay(planId, 1, gymB))).toMatch(/foreign key/);
    });

    it('deleting a plan deletes its days and exercises', async () => {
      const planId = await newPlan();
      const dayId = await newDay(planId, 1);
      await systemDb.insert(planExercises).values(exRow(dayId));
      await systemDb.delete(plans).where(eq(plans.id, planId));
      expect(await systemDb.select().from(planDays).where(eq(planDays.planId, planId))).toEqual([]);
      expect(
        await systemDb.select().from(planExercises).where(eq(planExercises.planDayId, dayId)),
      ).toEqual([]);
    });
  });

  describe('plan_exercises', () => {
    let dayId: string;
    beforeAll(async () => {
      dayId = await newDay(await newPlan(), 1);
    });
    const insert = (over: Partial<typeof planExercises.$inferInsert>) =>
      systemDb.insert(planExercises).values(exRow(dayId, over));

    it('accepts a valid row and rejects the targets the API forbids', async () => {
      await insert({ position: 1, weightKg: '20.25', restSeconds: 90, notes: 'ok' });
      await insert({ position: 2, repsMin: null, repsMax: null, toFailure: true });
      await insert({ position: 3, repsMin: null, repsMax: null, durationSeconds: 60 });
      // Each bad row must be stopped by the rule it breaks (constraint name), not by any check.
      const bad: [Partial<typeof planExercises.$inferInsert>, RegExp][] = [
        [{ sets: 0 }, /sets_chk/],
        [{ sets: 21 }, /sets_chk/],
        [{ repsMin: 12, repsMax: 8 }, /reps_chk/],
        [{ repsMin: 0 }, /reps_chk/],
        [{ repsMax: 101 }, /reps_chk/],
        [{ repsMin: 8, repsMax: null }, /reps_chk/],
        [{ repsMin: null, repsMax: 8 }, /reps_chk/],
        [{ toFailure: true }, /reps_chk/], // helper keeps 8–10
        [{ weightKg: '1000' }, /weight_chk|numeric field overflow/], // numeric(5,2) tops out at 999.99
        [{ weightKg: '999.80' }, /weight_chk/],
        [{ weightKg: '-1' }, /weight_chk/],
        [{ weightKg: '20.30' }, /weight_chk/],
        [{ restSeconds: 901 }, /rest_chk/],
        [{ restSeconds: -1 }, /rest_chk/],
        [{ durationSeconds: 0 }, /duration_chk/],
        [{ durationSeconds: 7201 }, /duration_chk/],
        [{ notes: 'x'.repeat(301) }, /notes_chk/],
      ];
      for (const [i, [over, rule]] of bad.entries()) {
        expect(
          await rejectionMessage(insert({ position: 10 + i, ...over })),
          JSON.stringify(over),
        ).toMatch(rule);
      }
    });

    it('accepts every upper and lower boundary the API allows', async () => {
      await insert({
        position: 20,
        sets: 1,
        repsMin: 1,
        repsMax: 1,
        weightKg: '0',
        restSeconds: 0,
      });
      await insert({
        position: 21,
        sets: 20,
        repsMin: 100,
        repsMax: 100,
        weightKg: '999.75',
        restSeconds: 900,
        durationSeconds: 7200,
        notes: 'x'.repeat(300),
      });
    });

    it('an exercise position outside 0–29 rejects', async () => {
      expect(await rejectionMessage(insert({ position: -1 }))).toMatch(
        /plan_exercises_position_chk/,
      );
      expect(await rejectionMessage(insert({ position: 30 }))).toMatch(
        /plan_exercises_position_chk/,
      );
    });

    it('the same position twice in one day rejects', async () => {
      expect(await rejectionMessage(insert({ position: 1 }))).toMatch(UNIQUE);
    });

    it('an exercise of another gym rejects (composite foreign key)', async () => {
      expect(await rejectionMessage(insert({ position: 25, exerciseId: exB }))).toMatch(
        /foreign key/,
      );
    });
  });

  describe('row-level security and privileges (gym_app)', () => {
    let aPlan: string;
    let bPlan: string;
    let aDay: string;
    let bDay: string;
    beforeAll(async () => {
      aPlan = await newPlan({ memberId: memberA });
      bPlan = await newPlan({ gymId: gymB, memberId: memberB });
      aDay = await newDay(aPlan, 1);
      bDay = await newDay(bPlan, 1, gymB);
      await systemDb.insert(planExercises).values(exRow(aDay));
      await systemDb
        .insert(planExercises)
        .values(exRow(bDay, { gymId: gymB, exerciseId: exB, position: 1 }));
    });

    it('withGym(A) sees only gym A rows in all three tables; without a gym nothing', async () => {
      for (const [table, gymCol] of [
        [plans, plans.gymId],
        [planDays, planDays.gymId],
        [planExercises, planExercises.gymId],
      ] as const) {
        const rows = await withGym(gymA, (tx) =>
          tx
            .select({ gym: gymCol })
            .from(table)
            .where(inArray(gymCol, [gymA, gymB])),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.gym === gymA)).toBe(true);
        expect(await db.select().from(table)).toEqual([]);
      }
    });

    it('withGym(A) cannot write into gym B or change a gym B row', async () => {
      expect(
        await rejectionMessage(
          withGym(gymA, (tx) => tx.insert(plans).values(plan({ gymId: gymB }))),
        ),
      ).toMatch(RLS_VIOLATION);
      expect(
        await rejectionMessage(
          withGym(gymA, (tx) =>
            tx.insert(planDays).values({ gymId: gymB, planId: bPlan, position: 5, title: 'x' }),
          ),
        ),
      ).toMatch(RLS_VIOLATION);
      expect(
        await rejectionMessage(
          withGym(gymA, (tx) =>
            tx
              .insert(planExercises)
              .values(exRow(bDay, { gymId: gymB, exerciseId: exB, position: 5 })),
          ),
        ),
      ).toMatch(RLS_VIOLATION);
      expect(
        await withGym(gymA, (tx) =>
          tx.update(plans).set({ title: 'hacked' }).where(eq(plans.id, bPlan)).returning(),
        ),
      ).toEqual([]);
      expect(
        await withGym(gymA, (tx) =>
          tx.update(planDays).set({ title: 'hacked' }).where(eq(planDays.id, bDay)).returning(),
        ),
      ).toEqual([]);
      expect(
        await withGym(gymA, (tx) =>
          tx.delete(planExercises).where(eq(planExercises.planDayId, bDay)).returning(),
        ),
      ).toEqual([]);
      const [still] = await systemDb.select().from(plans).where(eq(plans.id, bPlan));
      expect(still!.title).toBe('Πρόγραμμα');
      const [stillDay] = await systemDb.select().from(planDays).where(eq(planDays.id, bDay));
      expect(stillDay!.title).not.toBe('hacked');
      expect(
        await systemDb.select().from(planExercises).where(eq(planExercises.planDayId, bDay)),
      ).toHaveLength(1);
    });

    it('gym_app may archive a plan but cannot move it to another member or gym', async () => {
      await withGym(gymA, (tx) =>
        tx
          .update(plans)
          .set({ status: 'archived', archivedAt: new Date() })
          .where(eq(plans.id, aPlan)),
      );
      const [archived] = await systemDb.select().from(plans).where(eq(plans.id, aPlan));
      expect(archived!.status).toBe('archived');
      expect(archived!.archivedAt).not.toBeNull();
      for (const set of [
        { memberId: memberB },
        { gymId: gymB },
        { isTemplate: true },
        { kind: 'pdf' },
        { authorId: memberB },
      ]) {
        expect(
          await rejectionMessage(
            withGym(gymA, (tx) => tx.update(plans).set(set).where(eq(plans.id, aPlan))),
          ),
          JSON.stringify(set),
        ).toMatch(/permission denied/);
      }
      // Days and exercises cannot be re-parented or moved to another gym either.
      for (const set of [{ gymId: gymB }, { planId: bPlan }]) {
        expect(
          await rejectionMessage(
            withGym(gymA, (tx) => tx.update(planDays).set(set).where(eq(planDays.id, aDay))),
          ),
          JSON.stringify(set),
        ).toMatch(/permission denied/);
      }
      for (const set of [{ gymId: gymB }]) {
        expect(
          await rejectionMessage(
            withGym(gymA, (tx) =>
              tx.update(planExercises).set(set).where(eq(planExercises.planDayId, aDay)),
            ),
          ),
          JSON.stringify(set),
        ).toMatch(/permission denied/);
      }
    });

    it('gym_app can move an exercise to another day of its gym, keeping its id', async () => {
      const day2 = await newDay(aPlan, 5);
      const [ex] = await systemDb
        .select()
        .from(planExercises)
        .where(eq(planExercises.planDayId, aDay));
      await withGym(gymA, (tx) =>
        tx.update(planExercises).set({ planDayId: day2 }).where(eq(planExercises.id, ex!.id)),
      );
      const [moved] = await systemDb
        .select()
        .from(planExercises)
        .where(eq(planExercises.id, ex!.id));
      expect(moved!.planDayId).toBe(day2);
      // Not into a day of another gym (composite foreign key).
      expect(
        await rejectionMessage(
          withGym(gymA, (tx) =>
            tx.update(planExercises).set({ planDayId: bDay }).where(eq(planExercises.id, ex!.id)),
          ),
        ),
      ).toMatch(/foreign key/);
    });

    it('gym_app can delete a template but never a member plan', async () => {
      const member = await newPlan({ memberId: memberA, status: 'archived' });
      const template = await newPlan({ isTemplate: true, memberId: null });
      expect(
        await withGym(gymA, (tx) => tx.delete(plans).where(eq(plans.id, member)).returning()),
      ).toEqual([]);
      expect(await systemDb.select().from(plans).where(eq(plans.id, member))).toHaveLength(1);
      expect(
        await withGym(gymA, (tx) => tx.delete(plans).where(eq(plans.id, template)).returning()),
      ).toHaveLength(1);
    });
  });
});
