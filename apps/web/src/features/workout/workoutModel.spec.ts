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
    expect(newRow(card, [card])).toMatchObject({
      reps: 0,
      done: false,
      touched: false,
      index: 1,
    });
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

  it('a free exercise is prefilled row by row from last time; extra rows reuse its last set', () => {
    const free = {
      id: E1,
      nameEl: 'Πιέσεις στήθους',
      nameEn: null,
      muscleGroup: 'chest' as const,
      measure: 'weight_reps' as const,
      archived: false,
      createdBy: null,
    };
    const card = cardFromExercise(free, last);
    // no plan target: the first row copies last time's first set (10 × 52.5)
    expect(card.sets[0]).toMatchObject({ reps: 10, weightKg: 52.5 });
    // second row = last time's second set (9 × 52.5); a third has none, so the last one (9) again
    expect(newRow(card, [card])).toMatchObject({ reps: 9, weightKg: 52.5 });
    const two = { ...card, sets: [card.sets[0]!, { ...card.sets[0]!, index: 1 }] };
    expect(newRow(two, [two])).toMatchObject({ reps: 9, weightKg: 52.5, index: 2 });
  });

  it('clamps prefilled reps to 100 and a plan weight off the 0.25 grid onto it', () => {
    const card = cardFromPlanExercise(planEx({ repsMin: 500, weightKg: 22.3 }), null, 'el');
    // 22.3 kg → nearest quarter is 22.25
    expect(card.sets[0]).toMatchObject({ reps: 100, weightKg: 22.25 });
  });

  it('shows last time for timed and bodyweight exercises without kilos', () => {
    const timed: LastPerformance = {
      exerciseId: E1,
      sessionDate: '2027-05-10',
      sets: [
        { reps: null, weightKg: null, durationSeconds: 60 },
        { reps: null, weightKg: null, durationSeconds: 45 },
      ],
    };
    expect(formatLast(timed, 'duration', 'el')).toBe('60″, 45″');
    expect(formatLast(last, 'reps', 'el')).toBe('10, 9');
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
    const out = applyStored([card], stored)[0]!;
    // the stored set takes the first row and keeps its server index (1); rows stay at 3
    expect(out.sets[0]).toMatchObject({
      id: 'srv-1',
      reps: 9,
      weightKg: 55,
      done: true,
      touched: true,
      index: 1,
    });
    expect(out.sets.slice(1).every((s) => !s.touched && !s.done)).toBe(true);
    expect(out.sets).toHaveLength(3);
    // the untouched rows take the indexes the server does not hold: 0 and 2
    expect(out.sets.map((s) => s.index)).toEqual([1, 0, 2]);
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
    expect(applyStored([card], stored)[0]!.sets.map((s) => s.id)).toEqual(['s0', 's1', 's2']);
  });
});

describe('applyStored edges', () => {
  const stored = (over: Partial<WorkoutSet>): WorkoutSet => ({
    id: 'srv',
    exerciseId: E1,
    planExerciseId: PE1,
    measure: 'weight_reps',
    setIndex: 0,
    reps: 5,
    weightKg: 40,
    durationSeconds: null,
    done: true,
    loggedAt: '2027-05-12T08:00:00.000Z',
    ...over,
  });

  it('ignores sets of other exercises', () => {
    const card = cardFromPlanExercise(planEx(), null, 'el');
    const other = stored({
      exerciseId: '00000000-0000-4000-8000-000000000002',
      planExerciseId: '00000000-0000-4000-8000-0000000000a2',
    });
    const out = applyStored([card], [other])[0]!;
    expect(out.sets.every((s) => !s.touched && !s.done)).toBe(true);
  });

  it('a stored set keeps its server index wherever it sits, and untouched rows avoid it', () => {
    const card = cardFromPlanExercise(planEx(), null, 'el'); // 3 rows
    // the server holds only set 2 (0 and 1 were deleted while offline)
    const out = applyStored([card], [stored({ setIndex: 2 })])[0]!;
    expect(out.sets).toHaveLength(3);
    expect(out.sets[0]).toMatchObject({ id: 'srv', touched: true, index: 2 });
    expect(out.sets.map((s) => s.index)).toEqual([2, 0, 1]);
    expect(new Set(out.sets.map((s) => s.id)).size).toBe(3);
    // and the PUT for that row names index 2, not its position 0
    expect(setBody(out, 0, 'T').setIndex).toBe(2);
  });

  it('one exercise listed twice in a day gets distinct set indexes across both cards', () => {
    const a = cardFromPlanExercise(planEx({ sets: 2 }), null, 'el');
    const b = cardFromPlanExercise(
      planEx({ id: '00000000-0000-4000-8000-0000000000a2', sets: 2 }),
      null,
      'el',
    );
    // 4 rows of one exercise, nothing stored: 0,1 on the first card and 2,3 on the second
    const out = applyStored([a, b], []);
    expect(out.map((c) => c.sets.map((s) => s.index))).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(newRow(out[0]!, out).index).toBe(4);
  });
});

describe('setBody and canBeDone', () => {
  it('names the exercise, plan row, index, done flag and time exactly', () => {
    const w = cardFromPlanExercise(planEx(), null, 'el');
    w.sets[1] = { ...w.sets[1]!, done: true };
    expect(setBody(w, 1, '2027-05-12T08:00:00.000Z')).toEqual({
      exerciseId: E1,
      planExerciseId: PE1,
      setIndex: 1,
      reps: 8,
      weightKg: 50,
      durationSeconds: undefined,
      done: true,
      loggedAt: '2027-05-12T08:00:00.000Z',
    });
  });

  it('a bodyweight (reps) exercise sends no kilos and no seconds; a free one no plan row', () => {
    const card = cardFromExercise(
      {
        id: E1,
        nameEl: 'Έλξεις',
        nameEn: null,
        muscleGroup: 'back',
        measure: 'reps',
        archived: false,
        createdBy: null,
      },
      last,
    );
    const body = setBody(card, 0, 'T');
    expect(body).toMatchObject({ reps: 10, planExerciseId: null });
    expect(body.weightKg).toBeUndefined();
    expect(body.durationSeconds).toBeUndefined();
  });

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
        index: 0,
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
        index: 0,
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
        index: 0,
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

  it('counts an exercise only if one of its sets is done, and no kilos for bodyweight work', () => {
    const untouched = cardFromPlanExercise(planEx(), null, 'el');
    const pullups = cardFromPlanExercise(
      planEx({ exercise: { ...planEx().exercise, measure: 'reps' }, weightKg: 20 }),
      null,
      'el',
    );
    pullups.sets[0] = { ...pullups.sets[0]!, reps: 6, weightKg: 20, done: true };
    // 1 done set, 0 kg: only weight × reps work adds to the volume
    expect(summarise([untouched, pullups])).toEqual({ exercises: 1, sets: 1, volumeKg: 0 });
    expect(summarise([])).toEqual({ exercises: 0, sets: 0, volumeKg: 0 });
  });
});
