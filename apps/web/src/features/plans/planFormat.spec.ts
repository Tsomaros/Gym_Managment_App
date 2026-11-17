import type { PlanExercise } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import { formatTarget } from './planFormat';

const base: PlanExercise = {
  id: 'e1',
  exerciseId: 'x',
  exercise: {
    nameEl: 'Πιέσεις στήθους',
    nameEn: 'Bench press',
    muscleGroup: 'chest',
    measure: 'weight_reps',
    archived: false,
  },
  sets: 4,
  repsMin: 8,
  repsMax: 10,
  toFailure: false,
  weightKg: 50,
  restSeconds: 90,
  durationSeconds: null,
  notes: null,
};
const row = (over: Partial<PlanExercise>): PlanExercise => ({ ...base, ...over });

describe('formatTarget', () => {
  it('writes sets × a rep range @ weight', () => {
    expect(formatTarget(base, 'el')).toBe('4 × 8–10 @ 50 kg');
  });

  it('writes a single number when the range is one value', () => {
    expect(formatTarget(row({ sets: 3, repsMin: 12, repsMax: 12 }), 'el')).toBe('3 × 12 @ 50 kg');
  });

  it('writes max for "to failure"', () => {
    expect(formatTarget(row({ toFailure: true, repsMin: null, repsMax: null }), 'en')).toBe(
      '4 × max @ 50 kg',
    );
  });

  it('"to failure" wins over reps still stored on the row', () => {
    // repsMin 8 and repsMax 10 stay from `base`
    expect(formatTarget(row({ toFailure: true }), 'el')).toBe('4 × max @ 50 kg');
  });

  it('leaves out the weight when there is none, and keeps 0 kg and quarter kilos', () => {
    expect(formatTarget(row({ weightKg: null }), 'el')).toBe('4 × 8–10');
    expect(formatTarget(row({ weightKg: 0 }), 'el')).toBe('4 × 8–10 @ 0 kg');
    expect(formatTarget(row({ weightKg: 22.5 }), 'en')).toBe('4 × 8–10 @ 22.5 kg');
    expect(formatTarget(row({ weightKg: 22.5 }), 'el')).toBe('4 × 8–10 @ 22,5 kg');
    expect(formatTarget(row({ weightKg: 20.25 }), 'en')).toBe('4 × 8–10 @ 20.25 kg');
  });

  it('writes seconds for a duration exercise, with no reps or weight', () => {
    const plank = row({
      exercise: { ...base.exercise, measure: 'duration' },
      sets: 3,
      repsMin: null,
      repsMax: null,
      weightKg: null,
      durationSeconds: 60,
    });
    expect(formatTarget(plank, 'el')).toBe('3 × 60″');
  });

  it('a duration exercise shows seconds even if reps and kilos are still stored on the row', () => {
    const plank = row({
      exercise: { ...base.exercise, measure: 'duration' },
      sets: 3,
      durationSeconds: 45, // repsMin 8, repsMax 10 and weightKg 50 stay from `base`
    });
    expect(formatTarget(plank, 'el')).toBe('3 × 45″');
    expect(formatTarget(plank, 'en')).not.toMatch(/kg|8|10|50/);
  });

  it('falls back to the set count alone when the target has no reps, duration or weight', () => {
    expect(formatTarget(row({ repsMin: null, repsMax: null, weightKg: null }), 'el')).toBe('4 ×');
  });
});
