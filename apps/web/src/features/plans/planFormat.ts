import type { PlanExercise } from '@gym/shared';

/** kg with at most two decimals, in the reader's own notation (22,5 in Greek, 22.5 in English). */
export function formatKg(kg: number, lang: 'el' | 'en'): string {
  return new Intl.NumberFormat(lang === 'el' ? 'el-GR' : 'en-GB', {
    maximumFractionDigits: 2,
  }).format(kg);
}

/**
 * The target of one exercise as a trainer writes it: "4 × 8–10 @ 50 kg", "3 × 12", "4 × max"
 * (to failure) or "3 × 60″" (a timed exercise: seconds, no reps or weight).
 */
export function formatTarget(e: PlanExercise, lang: 'el' | 'en'): string {
  if (e.exercise.measure === 'duration') {
    return e.durationSeconds != null ? `${e.sets} × ${e.durationSeconds}″` : `${e.sets} ×`;
  }
  let text = `${e.sets} ×`;
  if (e.toFailure) text += ' max';
  else if (e.repsMin != null && e.repsMax != null) {
    text += e.repsMin === e.repsMax ? ` ${e.repsMin}` : ` ${e.repsMin}–${e.repsMax}`;
  }
  if (e.weightKg != null) text += ` @ ${formatKg(e.weightKg, lang)} kg`;
  return text;
}
