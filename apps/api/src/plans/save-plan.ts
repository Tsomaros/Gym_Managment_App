import { BadRequestException } from '@nestjs/common';
import type { PlanInput } from '@gym/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { exercises, planDays, planExercises } from '../db/schema';
import type { Tx } from '../db/tenant';

/**
 * Writes a plan's days and exercises so that ids stay stable (phase 4b's workout logs point at
 * them): an item sent with an id of this plan is updated in place (an exercise may move to another
 * day), one without an id is created, and every id of this plan that was not sent is deleted.
 * An id that belongs to another plan, or to nothing, is a 400.
 *
 * Exercise references must be this gym's unarchived exercises, except ones this plan already uses
 * (an archived exercise may stay in the plans that have it). Positions are 0-based; the unique
 * position constraints are deferred, so reordering inside this transaction is fine.
 */
export async function savePlanTree(
  tx: Tx,
  gymId: string,
  planId: string,
  input: PlanInput,
): Promise<void> {
  const existingDays = await tx
    .select({ id: planDays.id })
    .from(planDays)
    .where(eq(planDays.planId, planId));
  const existingExercises = await tx
    .select({ id: planExercises.id, exerciseId: planExercises.exerciseId })
    .from(planExercises)
    .innerJoin(planDays, eq(planExercises.planDayId, planDays.id))
    .where(eq(planDays.planId, planId));
  const dayIds = new Set(existingDays.map((d) => d.id));
  const exerciseRowIds = new Set(existingExercises.map((e) => e.id));
  const alreadyUsed = new Set(existingExercises.map((e) => e.exerciseId));

  for (const day of input.days) {
    if (day.id && !dayIds.has(day.id)) throw new BadRequestException('Unknown day id');
    for (const e of day.exercises) {
      if (e.id && !exerciseRowIds.has(e.id)) throw new BadRequestException('Unknown exercise id');
    }
  }

  const wanted = [...new Set(input.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
  if (wanted.length) {
    const found = await tx
      .select({ id: exercises.id, archivedAt: exercises.archivedAt })
      .from(exercises)
      .where(and(eq(exercises.gymId, gymId), inArray(exercises.id, wanted)));
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const id of wanted) {
      const row = byId.get(id);
      if (!row) throw new BadRequestException('Unknown exercise');
      if (row.archivedAt && !alreadyUsed.has(id)) {
        throw new BadRequestException('Archived exercise');
      }
    }
  }

  const keptDays = new Set(input.days.flatMap((d) => (d.id ? [d.id] : [])));
  const keptExercises = new Set(
    input.days.flatMap((d) => d.exercises.flatMap((e) => (e.id ? [e.id] : []))),
  );

  // 1. Exercises that were not sent go first, so removing a day later cannot take a moved one along.
  const goneExercises = [...exerciseRowIds].filter((id) => !keptExercises.has(id));
  if (goneExercises.length) {
    await tx.delete(planExercises).where(inArray(planExercises.id, goneExercises));
  }

  // 2. Days: update or create, in the order sent.
  const resolvedDayIds: string[] = [];
  for (const [position, day] of input.days.entries()) {
    if (day.id) {
      await tx.update(planDays).set({ position, title: day.title }).where(eq(planDays.id, day.id));
      resolvedDayIds.push(day.id);
    } else {
      const [row] = await tx
        .insert(planDays)
        .values({ gymId, planId, position, title: day.title })
        .returning({ id: planDays.id });
      resolvedDayIds.push(row!.id);
    }
  }

  // 3. Exercises: update (possibly into another day) or create.
  for (const [dayIndex, day] of input.days.entries()) {
    const planDayId = resolvedDayIds[dayIndex]!;
    for (const [position, e] of day.exercises.entries()) {
      const values = {
        planDayId,
        exerciseId: e.exerciseId,
        position,
        sets: e.sets,
        repsMin: e.toFailure ? null : (e.repsMin ?? null),
        repsMax: e.toFailure ? null : (e.repsMax ?? null),
        toFailure: e.toFailure,
        weightKg: e.weightKg == null ? null : String(e.weightKg),
        restSeconds: e.restSeconds ?? null,
        durationSeconds: e.durationSeconds ?? null,
        notes: e.notes ? e.notes : null,
      };
      if (e.id) await tx.update(planExercises).set(values).where(eq(planExercises.id, e.id));
      else await tx.insert(planExercises).values({ gymId, ...values });
    }
  }

  // 4. Days that were not sent (now empty of anything that was kept).
  const goneDays = [...dayIds].filter((id) => !keptDays.has(id));
  if (goneDays.length) await tx.delete(planDays).where(inArray(planDays.id, goneDays));
}
