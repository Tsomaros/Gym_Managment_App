import { asc, eq } from 'drizzle-orm';
import { planDays, planExercises } from '../db/schema';
import type { Tx } from '../db/tenant';

/**
 * Copies the days and exercises of one plan into another (a template into a client's plan, or a
 * plan into a template). Every day and exercise gets a new id and nothing links back to the source,
 * so later edits or deletion of either side never touch the other. Archived exercises are copied
 * as they are, the same way an existing plan keeps them.
 */
export async function copyPlanTree(
  tx: Tx,
  gymId: string,
  fromPlanId: string,
  toPlanId: string,
): Promise<void> {
  const days = await tx
    .select()
    .from(planDays)
    .where(eq(planDays.planId, fromPlanId))
    .orderBy(asc(planDays.position));
  for (const day of days) {
    const [copy] = await tx
      .insert(planDays)
      .values({ gymId, planId: toPlanId, position: day.position, title: day.title })
      .returning({ id: planDays.id });
    const rows = await tx
      .select()
      .from(planExercises)
      .where(eq(planExercises.planDayId, day.id))
      .orderBy(asc(planExercises.position));
    if (!rows.length) continue;
    await tx.insert(planExercises).values(
      rows.map((e) => ({
        gymId,
        planDayId: copy!.id,
        exerciseId: e.exerciseId,
        position: e.position,
        sets: e.sets,
        repsMin: e.repsMin,
        repsMax: e.repsMax,
        toFailure: e.toFailure,
        weightKg: e.weightKg,
        restSeconds: e.restSeconds,
        durationSeconds: e.durationSeconds,
        notes: e.notes,
      })),
    );
  }
}
