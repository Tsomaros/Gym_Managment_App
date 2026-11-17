import { describe, expect, it } from 'vitest';
import { CreatePlanSchema, PlanInputSchema } from '../src/index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ex = (over: Record<string, unknown> = {}) => ({
  exerciseId: uuid(1),
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  toFailure: false,
  ...over,
});
const day = (exercises: unknown[] = [ex()], over: Record<string, unknown> = {}) => ({
  title: 'Ημέρα Α',
  exercises,
  ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({
  title: 'Πάνω σώμα',
  days: [day()],
  ...over,
});
const parse = (v: unknown) => PlanInputSchema.safeParse(v);
const parseEx = (over: Record<string, unknown>) => parse(plan({ days: [day([ex(over)])] }));

describe('PlanInputSchema', () => {
  it('accepts a normal plan and fills the defaults', () => {
    const r = parse(plan({ days: [day([{ exerciseId: uuid(1), sets: 4, durationSeconds: 60 }])] }));
    expect(r.success).toBe(true);
    expect(r.data!.days[0]!.exercises[0]).toMatchObject({ toFailure: false, sets: 4 });
  });

  it('reps: min above max rejects, equal or ordered accepts', () => {
    expect(parseEx({ repsMin: 12, repsMax: 8 }).success).toBe(false);
    expect(parseEx({ repsMin: 8, repsMax: 8 }).success).toBe(true);
    expect(parseEx({ repsMin: 8, repsMax: 12 }).success).toBe(true);
  });

  it('reps: one bound alone rejects, and both must be 1–100', () => {
    expect(parseEx({ repsMin: 8, repsMax: undefined }).success).toBe(false);
    expect(parseEx({ repsMin: undefined, repsMax: 8 }).success).toBe(false);
    expect(parseEx({ repsMin: 0, repsMax: 8 }).success).toBe(false);
    expect(parseEx({ repsMin: 8, repsMax: 101 }).success).toBe(false);
    expect(parseEx({ repsMin: 100, repsMax: 100 }).success).toBe(true);
  });

  it('to failure: with no reps accepts, with repsMin rejects', () => {
    expect(parseEx({ toFailure: true, repsMin: undefined, repsMax: undefined }).success).toBe(true);
    expect(parseEx({ toFailure: true, repsMin: null, repsMax: null }).success).toBe(true);
    expect(parseEx({ toFailure: true, repsMin: 8, repsMax: undefined }).success).toBe(false);
    expect(parseEx({ toFailure: true }).success).toBe(false); // helper's 8–10 still set
    expect(parseEx({ toFailure: true, repsMin: undefined, repsMax: 8 }).success).toBe(false);
  });

  it('duration 1–7200 s; plan notes up to 1000 characters', () => {
    expect(parseEx({ durationSeconds: 7200 }).success).toBe(true);
    expect(parseEx({ durationSeconds: 7201 }).success).toBe(false);
    expect(parse(plan({ notes: 'x'.repeat(1000) })).success).toBe(true);
    expect(parse(plan({ notes: 'x'.repeat(1001) })).success).toBe(false);
  });

  it('sets: 1–20', () => {
    expect(parseEx({ sets: 0 }).success).toBe(false);
    expect(parseEx({ sets: 21 }).success).toBe(false);
    expect(parseEx({ sets: 20 }).success).toBe(true);
    expect(parseEx({ sets: 2.5 }).success).toBe(false);
  });

  it('weight: 20.3 rejects, 20.25 accepts, bounds 0 and 999.75, null allowed', () => {
    expect(parseEx({ weightKg: 20.3 }).success).toBe(false);
    expect(parseEx({ weightKg: 20.25 }).success).toBe(true);
    expect(parseEx({ weightKg: 0 }).success).toBe(true);
    expect(parseEx({ weightKg: 999.75 }).success).toBe(true);
    expect(parseEx({ weightKg: 1000 }).success).toBe(false);
    expect(parseEx({ weightKg: -1 }).success).toBe(false);
    expect(parseEx({ weightKg: null }).success).toBe(true);
  });

  it('rest 0–900 s, duration positive, notes up to 300 characters', () => {
    expect(parseEx({ restSeconds: 900 }).success).toBe(true);
    expect(parseEx({ restSeconds: 901 }).success).toBe(false);
    expect(parseEx({ restSeconds: -1 }).success).toBe(false);
    expect(parseEx({ durationSeconds: 0 }).success).toBe(false);
    expect(parseEx({ notes: 'x'.repeat(300) }).success).toBe(true);
    expect(parseEx({ notes: 'x'.repeat(301) }).success).toBe(false);
  });

  it('title: 1 character accepts, 81 rejects, blank rejects; day titles follow the same rule', () => {
    expect(parse(plan({ title: 'Α' })).success).toBe(true);
    expect(parse(plan({ title: 'Α'.repeat(80) })).success).toBe(true);
    expect(parse(plan({ title: 'Α'.repeat(81) })).success).toBe(false);
    expect(parse(plan({ title: '   ' })).success).toBe(false);
    expect(parse(plan({ days: [day([ex()], { title: '' })] })).success).toBe(false);
  });

  it('limits: 14 days accept, 15 reject; 30 exercises a day accept, 31 reject; at least one day', () => {
    expect(parse(plan({ days: Array.from({ length: 14 }, () => day()) })).success).toBe(true);
    expect(parse(plan({ days: Array.from({ length: 15 }, () => day()) })).success).toBe(false);
    expect(parse(plan({ days: [day(Array.from({ length: 30 }, () => ex()))] })).success).toBe(true);
    expect(parse(plan({ days: [day(Array.from({ length: 31 }, () => ex()))] })).success).toBe(
      false,
    );
    expect(parse(plan({ days: [] })).success).toBe(false);
  });

  it('ids: must be uuids, and the same id twice in one save rejects', () => {
    expect(parseEx({ id: 'nope' }).success).toBe(false);
    expect(
      parse(plan({ days: [day([ex({ id: uuid(5) }), ex({ id: uuid(6) })], { id: uuid(7) })] }))
        .success,
    ).toBe(true);
    expect(parse(plan({ days: [day([ex({ id: uuid(5) }), ex({ id: uuid(5) })])] })).success).toBe(
      false,
    );
    expect(
      parse(plan({ days: [day([ex()], { id: uuid(7) }), day([ex()], { id: uuid(7) })] })).success,
    ).toBe(false);
    // A day id reused as an exercise id (across levels) rejects too.
    expect(parse(plan({ days: [day([ex({ id: uuid(7) })], { id: uuid(7) })] })).success).toBe(
      false,
    );
  });
});

describe('CreatePlanSchema', () => {
  it('accepts activate and applies the same limits and duplicate-id rule', () => {
    expect(CreatePlanSchema.safeParse({ ...plan(), activate: true }).success).toBe(true);
    expect(CreatePlanSchema.safeParse({ ...plan({ days: [] }), activate: true }).success).toBe(
      false,
    );
    const dup = plan({ days: [day([ex({ id: uuid(5) }), ex({ id: uuid(5) })])] });
    expect(CreatePlanSchema.safeParse(dup).success).toBe(false);
  });
});
