import type { Exercise, Plan, PlanExercise, PlanInput } from '@gym/shared';

/** The plan being edited: what the screen holds before a save. Ids exist only for stored items. */
export interface DraftExercise {
  /** Identity inside the editor (React keys), never sent to the API. */
  key: string;
  id?: string;
  exerciseId: string;
  exercise: PlanExercise['exercise'];
  /** Null while the field is cleared to retype it; saving then fails the validation. */
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  toFailure: boolean;
  weightKg: number | null;
  restSeconds: number | null;
  durationSeconds: number | null;
  notes: string;
}

export interface DraftDay {
  key: string;
  id?: string;
  title: string;
  exercises: DraftExercise[];
}

export interface Draft {
  title: string;
  notes: string;
  days: DraftDay[];
}

let counter = 0;
const nextKey = () => `k${++counter}`;

export function blankDay(title: string): DraftDay {
  return { key: nextKey(), title, exercises: [] };
}

/** A new plan: one empty day to start from. */
export function blankDraft(firstDayTitle: string): Draft {
  return { title: '', notes: '', days: [blankDay(firstDayTitle)] };
}

export function draftFromPlan(plan: Plan): Draft {
  return {
    title: plan.title,
    notes: plan.notes ?? '',
    days: plan.days.map((d) => ({
      key: nextKey(),
      id: d.id,
      title: d.title,
      exercises: d.exercises.map((e) => ({
        key: nextKey(),
        id: e.id,
        exerciseId: e.exerciseId,
        exercise: e.exercise,
        sets: e.sets,
        repsMin: e.repsMin,
        repsMax: e.repsMax,
        toFailure: e.toFailure,
        weightKg: e.weightKg,
        restSeconds: e.restSeconds,
        durationSeconds: e.durationSeconds,
        notes: e.notes ?? '',
      })),
    })),
  };
}

/** A library exercise added to a day, with the targets a trainer most often starts from. */
export function newDraftExercise(e: Exercise): DraftExercise {
  const timed = e.measure === 'duration';
  return {
    key: nextKey(),
    exerciseId: e.id,
    exercise: {
      nameEl: e.nameEl,
      nameEn: e.nameEn,
      muscleGroup: e.muscleGroup,
      measure: e.measure,
      archived: e.archived,
    },
    sets: 3,
    repsMin: timed ? null : 8,
    repsMax: timed ? null : 12,
    toFailure: false,
    weightKg: null,
    restSeconds: null,
    durationSeconds: timed ? 60 : null,
    notes: '',
  };
}

/** The body the API saves: ids only on stored items, "to failure" with no reps, blank text as null. */
export function toPlanInput(draft: Draft): PlanInput {
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim() || null,
    days: draft.days.map((d) => ({
      ...(d.id ? { id: d.id } : {}),
      title: d.title.trim(),
      exercises: d.exercises.map((e) => ({
        ...(e.id ? { id: e.id } : {}),
        exerciseId: e.exerciseId,
        sets: e.sets as number,
        repsMin: e.toFailure ? null : e.repsMin,
        repsMax: e.toFailure ? null : e.repsMax,
        toFailure: e.toFailure,
        weightKg: e.weightKg,
        restSeconds: e.restSeconds,
        durationSeconds: e.durationSeconds,
        notes: e.notes.trim() || null,
      })),
    })),
  };
}

/** Has the draft changed since `saved` (the input it was last saved or loaded as)? */
export function isDirty(draft: Draft, saved: PlanInput): boolean {
  return JSON.stringify(toPlanInput(draft)) !== JSON.stringify(saved);
}

/** A copy with the item at `index` moved by `delta` places; the ends stay put. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  const copy = [...list];
  if (target < 0 || target >= copy.length) return copy;
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

/**
 * `fresh` (rebuilt from what the API stored) wearing the keys of `old`, matched by position, so
 * the screen keeps its rows, collapsed days, scroll and focus after a save.
 */
export function keepKeys(old: Draft, fresh: Draft): Draft {
  return {
    ...fresh,
    days: fresh.days.map((day, i) => {
      const before = old.days[i];
      return {
        ...day,
        key: before?.key ?? day.key,
        exercises: day.exercises.map((e, j) => ({ ...e, key: before?.exercises[j]?.key ?? e.key })),
      };
    }),
  };
}
