import type { LastPerformance, PlanExercise, WorkoutSet } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import {
  applyStored,
  canBeDone,
  cardFromExercise,
  cardFromPlanExercise,
  formatDuration,
  formatLast,
  newRow,
  parseDecimal,
  parseDuration,
  setBody,
  summarise,
  toKgStep,
} from './workoutModel';

const E1 = '00000000-0000-4000-8000-000000000001';
const PE1 = '00000000-0000-4000-8000-0000000000a1';

const planEx = (over: Partial<PlanExercise> = {}): PlanExercise => ({
  id: PE1,
  exerciseId: E1,
  exercise: {
    nameEl: 'Πιέσεις στήθους',
    nameEn: 'Bench press',
    muscleGroup: 'chest',
    measure: 'weight_reps',
    archived: false,
  },
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  toFailure: false,
  weightKg: 50,
  restSeconds: 90,
  durationSeconds: null,
  notes: null,
  ...over,
});

const last: LastPerformance = {
  exerciseId: E1,
  sessionDate: '2027-05-10',
  sets: [
    { reps: 10, weightKg: 52.5, durationSeconds: null },
    { reps: 9, weightKg: 52.5, durationSeconds: null },
  ],
};

describe('parseDecimal', () => {
  it('reads a Greek comma and a dot alike', () => {
    expect(parseDecimal('22,5')).toBe(22.5);
    expect(parseDecimal('22.5')).toBe(22.5);
    expect(parseDecimal(' 80 ')).toBe(80);
    expect(parseDecimal(',5')).toBe(0.5);
  });
  it('rejects text, signs and two separators', () => {
    for (const bad of ['', 'abc', '-3', '1,2,3', '1.2.3', '1e3', '--']) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });
});

describe('toKgStep', () => {
  it('rounds to 0.25 and stays within 0–999.75', () => {
    expect(toKgStep(22.3)).toBe(22.25);
    expect(toKgStep(22.4)).toBe(22.5);
    expect(toKgStep(-4)).toBe(0);
    expect(toKgStep(5000)).toBe(999.75);
  });
});

describe('duration', () => {
  it('formats and parses mm:ss and plain seconds', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(45)).toBe('0:45');
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('0:05')).toBe(5);
    expect(parseDuration('1:75')).toBeNull();
    expect(parseDuration('x')).toBeNull();
  });
});

describe('cards', () => {
  it('prefills a plan exercise: target reps, last session’s weight, one row per target set', () => {
    const card = cardFromPlanExercise(planEx(), last, 'el');
    expect(card.target).toBe('3 × 8–10 @ 50 kg');
    expect(card.restSeconds).toBe(90);
    expect(card.sets).toHaveLength(3);
    expect(card.sets.map((s) => [s.reps, s.weightKg, s.done, s.touched])).toEqual([
      [8, 52.5, false, false],
      [8, 52.5, false, false],
      [8, 52.5, false, false], // beyond last time's sets: the last one is the reference
    ]);
    expect(new Set(card.sets.map((s) => s.id)).size).toBe(3);
  });

  it('falls back to the plan weight without a last session, and to zero for "max" sets', () => {
    const card = cardFromPlanExercise(
      planEx({ toFailure: true, repsMin: null, repsMax: null }),
      null,
      'el',
    );
    expect(card.sets[0]).toMatchObject({ reps: 0, weightKg: 50 });
  });

  it('a free exercise starts with one empty row and grows with newRow', () => {
    const card = cardFromExercise(
      {
        id: E1,
        nameEl: 'Άσκηση',
        nameEn: null,
        muscleGroup: 'core',
        measure: 'reps',
        archived: false,
        createdBy: null,
      },
      null,
    );
    expect(card.target).toBeNull();
    expect(card.sets).toHaveLength(1);
    expect(newRow(card)).toMatchObject({ reps: 0, done: false, touched: false });
  });

  it('a timed exercise starts at the target seconds, never below one second', () => {
    const plank = planEx({
      exercise: { ...planEx().exercise, measure: 'duration' },
      durationSeconds: 45,
    });
    expect(cardFromPlanExercise(plank, null, 'el').sets[0]!.durationSeconds).toBe(45);
    const none = cardFromExercise(
      {
        id: E1,
        nameEl: 'Σανίδα',
        nameEn: null,
        muscleGroup: 'core',
        measure: 'duration',
        archived: false,
        createdBy: null,
      },
      null,
    );
    expect(none.sets[0]!.durationSeconds).toBe(60);
  });

  it('shows last time as a line in the viewer’s number format', () => {
    expect(formatLast(last, 'weight_reps', 'el')).toBe('52,5×10, 52,5×9');
    expect(formatLast(last, 'weight_reps', 'en')).toBe('52.5×10, 52.5×9');
  });
});

describe('applyStored', () => {
  it('puts the server’s sets into their rows and keeps the rest untouched', () => {
    const card = cardFromPlanExercise(planEx(), null, 'el');
    const stored: WorkoutSet[] = [
      {
        id: 'srv-1',
        exerciseId: E1,
        planExerciseId: PE1,
        measure: 'weight_reps',
        setIndex: 1,
        reps: 9,
        weightKg: 55,
        durationSeconds: null,
        done: true,
        loggedAt: '2027-05-12T08:00:00.000Z',
      },
    ];
    const out = applyStored(card, stored);
    expect(out.sets[1]).toMatchObject({
      id: 'srv-1',
      reps: 9,
      weightKg: 55,
      done: true,
      touched: true,
    });
    expect(out.sets[0]!.touched).toBe(false);
    expect(out.sets).toHaveLength(3);
  });

  it('grows the card when the server holds more sets than the target', () => {
    const card = cardFromPlanExercise(planEx({ sets: 1 }), null, 'el');
    const stored = [0, 1, 2].map((i) => ({
      id: `s${i}`,
      exerciseId: E1,
      planExerciseId: PE1,
      measure: 'weight_reps' as const,
      setIndex: i,
      reps: 5,
      weightKg: 40,
      durationSeconds: null,
      done: true,
      loggedAt: '2027-05-12T08:00:00.000Z',
    }));
    expect(applyStored(card, stored).sets.map((s) => s.id)).toEqual(['s0', 's1', 's2']);
  });
});

describe('setBody and canBeDone', () => {
  it('sends only the values the exercise is measured by', () => {
    const w = cardFromPlanExercise(planEx(), null, 'el');
    expect(setBody(w, 0, 'T')).toMatchObject({ reps: 8, weightKg: 50, durationSeconds: undefined });
    const d = cardFromPlanExercise(
      planEx({ exercise: { ...planEx().exercise, measure: 'duration' }, durationSeconds: 30 }),
      null,
      'el',
    );
    expect(setBody(d, 0, 'T')).toMatchObject({
      reps: undefined,
      weightKg: undefined,
      durationSeconds: 30,
    });
  });

  it('a set with no reps cannot be done; a timed set needs a second', () => {
    expect(
      canBeDone('weight_reps', {
        id: 'x',
        reps: 0,
        weightKg: 50,
        durationSeconds: 60,
        done: false,
        touched: false,
      }),
    ).toBe(false);
    expect(
      canBeDone('weight_reps', {
        id: 'x',
        reps: 1,
        weightKg: 0,
        durationSeconds: 60,
        done: false,
        touched: false,
      }),
    ).toBe(true);
    expect(
      canBeDone('duration', {
        id: 'x',
        reps: 0,
        weightKg: 0,
        durationSeconds: 0,
        done: false,
        touched: false,
      }),
    ).toBe(false);
  });
});

describe('summarise', () => {
  it('counts done sets and the weight lifted, not the undone ones', () => {
    const card = cardFromPlanExercise(planEx(), null, 'el');
    card.sets[0] = { ...card.sets[0]!, reps: 10, weightKg: 50, done: true };
    card.sets[1] = { ...card.sets[1]!, reps: 5, weightKg: 80, done: true };
    expect(summarise([card])).toEqual({ exercises: 1, sets: 2, volumeKg: 900 });
  });
});
