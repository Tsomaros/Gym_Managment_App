import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Exercise, ExerciseInput, ExercisePatch, ExerciseQuery, GymRole } from '@gym/shared';
import { and, asc, eq, isNull, or, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { likeEscape, normalised } from '../common/search';
import { exercises } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';

const MAX_RESULTS = 200;

type Row = typeof exercises.$inferSelect;
const toExercise = (r: Row): Exercise => ({
  id: r.id,
  nameEl: r.nameEl,
  nameEn: r.nameEn,
  muscleGroup: r.muscleGroup as Exercise['muscleGroup'],
  measure: r.measure as Exercise['measure'],
  archived: r.archivedAt !== null,
  createdBy: r.createdBy,
});

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === '23505' || err.cause?.code === '23505';
}

/** A duplicate name that slipped past the pre-check (two writers at once) is the same 409. */
function asConflict(e: unknown): never {
  if (isUniqueViolation(e)) throw new ConflictException('This exercise already exists');
  throw e;
}

@Injectable()
export class ExercisesService {
  constructor(private readonly audit: AuditService) {}

  list(gymId: string, q: ExerciseQuery): Promise<Exercise[]> {
    return withGym(gymId, async (tx) => {
      const filters: SQL[] = [];
      if (!q.includeArchived) filters.push(isNull(exercises.archivedAt));
      if (q.muscleGroup) filters.push(eq(exercises.muscleGroup, q.muscleGroup));
      if (q.q) {
        const needle = normalised(sql`${`%${likeEscape(q.q)}%`}`);
        filters.push(
          or(
            sql`${normalised(sql`${exercises.nameEl}`)} like ${needle}`,
            sql`${normalised(sql`coalesce(${exercises.nameEn}, '')`)} like ${needle}`,
          )!,
        );
      }
      const rows = await tx
        .select()
        .from(exercises)
        .where(filters.length ? and(...filters) : undefined)
        // Sorted by the accent-free name: stable whatever the database collation is.
        .orderBy(asc(normalised(sql`${exercises.nameEl}`)), asc(exercises.id))
        .limit(MAX_RESULTS);
      return rows.map(toExercise);
    });
  }

  create(gymId: string, actorId: string, input: ExerciseInput): Promise<Exercise> {
    return withGym(gymId, async (tx) => {
      await this.assertNameFree(tx, input.nameEl);
      const [row] = await tx
        .insert(exercises)
        .values({
          gymId,
          nameEl: input.nameEl,
          nameEn: input.nameEn ?? null,
          muscleGroup: input.muscleGroup,
          measure: input.measure,
          createdBy: actorId,
        })
        .returning()
        .catch(asConflict);
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'exercise.created',
        entity: 'exercise',
        entityId: row!.id,
        data: { nameEl: row!.nameEl, muscleGroup: row!.muscleGroup },
      });
      return toExercise(row!);
    });
  }

  update(gymId: string, actorId: string, id: string, patch: ExercisePatch): Promise<Exercise> {
    return withGym(gymId, async (tx) => {
      const [current] = await tx
        .select({ id: exercises.id })
        .from(exercises)
        .where(eq(exercises.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (patch.nameEl !== undefined) await this.assertNameFree(tx, patch.nameEl, id);
      const [row] = await tx
        .update(exercises)
        .set({
          ...(patch.nameEl !== undefined && { nameEl: patch.nameEl }),
          ...(patch.nameEn !== undefined && { nameEn: patch.nameEn }),
          ...(patch.muscleGroup !== undefined && { muscleGroup: patch.muscleGroup }),
          ...(patch.measure !== undefined && { measure: patch.measure }),
        })
        .where(eq(exercises.id, id))
        .returning()
        .catch(asConflict);
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'exercise.updated',
        entity: 'exercise',
        entityId: id,
        data: { nameEl: row!.nameEl, changed: Object.keys(patch) },
      });
      return toExercise(row!);
    });
  }

  /** The owner or the exercise's creator. Already archived: nothing to do. */
  archive(gymId: string, actorId: string, roles: GymRole[], id: string): Promise<void> {
    return withGym(gymId, async (tx) => {
      const [current] = await tx.select().from(exercises).where(eq(exercises.id, id)).for('update');
      if (!current) throw new NotFoundException();
      if (!roles.includes('owner') && current.createdBy !== actorId) throw new ForbiddenException();
      if (current.archivedAt) return;
      await tx.update(exercises).set({ archivedAt: new Date() }).where(eq(exercises.id, id));
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'exercise.archived',
        entity: 'exercise',
        entityId: id,
        data: { nameEl: current.nameEl },
      });
    });
  }

  /**
   * Names are unique ignoring case (a database index) and also ignoring accents and final sigma
   * (this pre-check, which can race, but only for an accent-only variant). Archived exercises
   * keep their name reserved.
   */
  private async assertNameFree(tx: Tx, nameEl: string, exceptId?: string): Promise<void> {
    const same = sql`${normalised(sql`${exercises.nameEl}`)} = ${normalised(sql`${nameEl}`)}`;
    const [hit] = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(exceptId ? and(same, sql`${exercises.id} <> ${exceptId}`) : same);
    if (hit) throw new ConflictException('This exercise already exists');
  }
}
