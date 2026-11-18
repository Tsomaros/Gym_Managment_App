import type { WorkoutSet } from '@gym/shared';
import { pending } from './workoutQueue';

/**
 * Sets queued for a session this phone started but could not send yet (it went offline, then the
 * page was reloaded): the same session is picked up again instead of starting a second one.
 */
export function resumableFromQueue(
  base: string,
  dayId: string | undefined,
): { id: string; startedAt: string; sets: WorkoutSet[] } | null {
  const ops = pending();
  const isSession = (op: (typeof ops)[number]) =>
    op.method === 'PUT' && op.path.startsWith(`${base}/`) && !op.path.includes('/sets/');
  // A session with a queued finish is over, whichever of its operations comes first.
  const finished = new Set(
    ops
      .filter((op) => isSession(op) && (op.body as { finishedAt?: string }).finishedAt)
      .map((op) => op.path.slice(base.length + 1)),
  );
  let found: { id: string; startedAt: string } | null = null;
  for (const op of ops) {
    if (!isSession(op)) continue;
    const body = op.body as { startedAt: string; planDayId?: string };
    const id = op.path.slice(base.length + 1);
    // one for another day is another workout
    if (finished.has(id) || (body.planDayId ?? undefined) !== dayId) continue;
    found = { id, startedAt: body.startedAt };
  }
  if (!found) return null;
  const sets = new Map<string, WorkoutSet>();
  for (const op of ops) {
    const m = new RegExp(`^${base}/${found.id}/sets/([^/]+)$`).exec(op.path);
    if (!m) continue;
    if (op.method === 'DELETE') sets.delete(m[1]!);
    else if (op.method === 'PUT') {
      const b = op.body as Omit<
        WorkoutSet,
        'id' | 'measure' | 'reps' | 'weightKg' | 'durationSeconds' | 'planExerciseId'
      > & {
        reps?: number;
        weightKg?: number;
        durationSeconds?: number;
        planExerciseId?: string | null;
      };
      sets.set(m[1]!, {
        id: m[1]!,
        exerciseId: b.exerciseId,
        planExerciseId: b.planExerciseId ?? null,
        measure:
          b.weightKg !== undefined
            ? 'weight_reps'
            : b.durationSeconds !== undefined
              ? 'duration'
              : 'reps',
        setIndex: b.setIndex,
        reps: b.reps ?? null,
        weightKg: b.weightKg ?? null,
        durationSeconds: b.durationSeconds ?? null,
        done: b.done,
        loggedAt: b.loggedAt,
      });
    }
  }
  return { ...found, sets: [...sets.values()] };
}
