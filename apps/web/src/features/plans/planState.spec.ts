import type { Exercise, Plan } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import {
  type Draft,
  blankDraft,
  draftFromPlan,
  isDirty,
  moveItem,
  newDraftExercise,
  toPlanInput,
} from './planState';

const EX_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EX_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const info = {
  nameEl: 'Πιέσεις στήθους',
  nameEn: 'Bench press',
  muscleGroup: 'chest' as const,
  measure: 'weight_reps' as const,
  archived: false,
};

const plan: Plan = {
  id: 'p1',
  memberId: 'm1',
  authorId: 't1',
  author: { firstName: 'Νίκος', lastName: 'Γυμναστής' },
  isTemplate: false,
  kind: 'interactive',
  title: 'Πάνω σώμα',
  notes: 'Τρεις φορές',
  status: 'active',
  pdfUrl: null,
  activatedAt: '2027-05-12T09:00:00.000Z',
  days: [
    {
      id: 'd1',
      title: 'Ημέρα Α',
      exercises: [
        {
          id: 'e1',
          exerciseId: EX_A,
          exercise: info,
          sets: 4,
          repsMin: 8,
          repsMax: 10,
          toFailure: false,
          weightKg: 50,
          restSeconds: 90,
          durationSeconds: null,
          notes: 'Αργά',
        },
        {
          id: 'e2',
          exerciseId: EX_B,
          exercise: { ...info, nameEl: 'Έλξεις', measure: 'reps' },
          sets: 3,
          repsMin: null,
          repsMax: null,
          toFailure: true,
          weightKg: null,
          restSeconds: null,
          durationSeconds: null,
          notes: null,
        },
      ],
    },
    { id: 'd2', title: 'Ημέρα Β', exercises: [] },
  ],
};

describe('plan editor state', () => {
  it('turns a stored plan into the input that saves it unchanged, keeping every id', () => {
    const input = toPlanInput(draftFromPlan(plan));
    expect(input.title).toBe('Πάνω σώμα');
    expect(input.notes).toBe('Τρεις φορές');
    expect(input.days.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(input.days[0]!.exercises.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(input.days[0]!.exercises[0]).toEqual({
      id: 'e1',
      exerciseId: EX_A,
      sets: 4,
      repsMin: 8,
      repsMax: 10,
      toFailure: false,
      weightKg: 50,
      restSeconds: 90,
      durationSeconds: null,
      notes: 'Αργά',
    });
  });

  it('is not dirty when nothing changed, dirty after any edit', () => {
    const draft = draftFromPlan(plan);
    const saved = toPlanInput(draft);
    expect(isDirty(draft, saved)).toBe(false);
    const renamed: Draft = {
      ...draft,
      days: [{ ...draft.days[0]!, title: 'Άλλη' }, draft.days[1]!],
    };
    expect(isDirty(renamed, saved)).toBe(true);
    expect(isDirty({ ...draft, title: 'Άλλος τίτλος' }, saved)).toBe(true);
    const moved = { ...draft, days: [draft.days[1]!, draft.days[0]!] };
    expect(isDirty(moved, saved)).toBe(true);
  });

  it('a new exercise has no id, sensible defaults and the library details to show', () => {
    const lib: Exercise = {
      id: EX_A,
      nameEl: 'Πιέσεις στήθους',
      nameEn: 'Bench press',
      muscleGroup: 'chest',
      measure: 'weight_reps',
      archived: false,
      createdBy: null,
    };
    const row = newDraftExercise(lib);
    expect(row.id).toBeUndefined();
    expect(row).toMatchObject({
      exerciseId: EX_A,
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      toFailure: false,
    });
    expect(row.exercise.nameEl).toBe('Πιέσεις στήθους');
    const input = toPlanInput({
      title: 'Χ',
      notes: '',
      days: [{ key: 'k', title: 'Α', exercises: [row] }],
    });
    expect(input.days[0]!.exercises[0]).not.toHaveProperty('id');
    expect(input.days[0]!.id).toBeUndefined();
  });

  it('a duration exercise starts with seconds, no reps and no weight', () => {
    const row = newDraftExercise({
      id: EX_B,
      nameEl: 'Σανίδα',
      nameEn: null,
      muscleGroup: 'core',
      measure: 'duration',
      archived: false,
      createdBy: null,
    });
    expect(row).toMatchObject({
      repsMin: null,
      repsMax: null,
      weightKg: null,
      durationSeconds: 60,
    });
  });

  it('to failure sends no reps even if they were typed before', () => {
    const draft = draftFromPlan(plan);
    const first = draft.days[0]!.exercises[0]!;
    first.toFailure = true; // repsMin 8 / repsMax 10 are still in the row
    const sent = toPlanInput(draft).days[0]!.exercises[0]!;
    expect(sent).toMatchObject({ toFailure: true, repsMin: null, repsMax: null });
  });

  it('moves an item up or down without touching the others, and stops at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('moving day 2 up sends the days in the new order with their ids', () => {
    const draft = draftFromPlan(plan);
    const reordered = { ...draft, days: moveItem(draft.days, 1, -1) };
    const input = toPlanInput(reordered);
    expect(input.days.map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(input.days[1]!.exercises.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('a blank draft has one empty day and no ids', () => {
    const blank = blankDraft('Ημέρα Α');
    expect(blank.title).toBe('');
    expect(blank.days).toHaveLength(1);
    expect(blank.days[0]!.title).toBe('Ημέρα Α');
    expect(blank.days[0]!.exercises).toEqual([]);
    expect(blank.days[0]!.id).toBeUndefined();
  });

  it('every row and day gets its own key, also across drafts', () => {
    const keys = [
      ...draftFromPlan(plan).days.flatMap((d) => [d.key, ...d.exercises.map((e) => e.key)]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
