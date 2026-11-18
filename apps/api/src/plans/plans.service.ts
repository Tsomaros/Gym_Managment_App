import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePlan,
  FromTemplate,
  GymRole,
  Plan,
  PlanDay,
  PlanExercise,
  PlanInput,
  PlanKind,
  PlanStatus,
  PlanSummary,
} from '@gym/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { namesOf } from '../common/names';
import { systemDb } from '../db/client';
import { exercises, planDays, planExercises, plans, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { gymToday } from '../memberships/memberships.service';
import { type PlanAccess, planAccess } from './plan-access';
import { copyPlanTree } from './copy-plan';
import { savePlanTree } from './save-plan';
import { NotificationService } from '../notifications/notification.service';
import { StorageService } from '../storage/storage.service';

export interface Caller {
  userId: string;
  roles: GymRole[];
}

type PlanRow = typeof plans.$inferSelect;

/** The member sees only plans that were ever activated: drafts, even archived ones, stay with the trainer. */
const hiddenFromMember = (r: PlanRow) => r.activatedAt === null;

export const countsOfPlan = (p: Plan) => ({
  days: p.days.length,
  exercises: p.days.reduce((n, d) => n + d.exercises.length, 0),
});

const counts = (input: PlanInput) => ({
  days: input.days.length,
  exercises: input.days.reduce((n, d) => n + d.exercises.length, 0),
});

/** What the history keeps of a plan: titles and counts, never the exercises themselves. */
const summaryData = (row: PlanRow) => ({
  title: row.title,
  kind: row.kind,
  memberId: row.memberId,
});

@Injectable()
export class PlansService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  /** A member's plans: active first, then drafts (staff only), then archived, newest first. */
  listForMember(gymId: string, caller: Caller, memberId: string): Promise<PlanSummary[]> {
    return withGym(gymId, async (tx) => {
      const access = await this.accessTo(tx, gymId, caller, memberId);
      if (!access) throw new NotFoundException();
      const rows = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.memberId, memberId)));
      const visible = rows.filter((r) => !(caller.userId === memberId && hiddenFromMember(r)));
      const rank = (r: PlanRow) => (r.status === 'active' ? 0 : r.status === 'draft' ? 1 : 2);
      visible.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
      const names = await namesOf(visible.map((r) => r.authorId));
      return visible.map((r) => toSummary(r, names));
    });
  }

  activeForMember(gymId: string, caller: Caller, memberId: string): Promise<Plan> {
    return withGym(gymId, async (tx) => {
      const access = await this.accessTo(tx, gymId, caller, memberId);
      if (!access) throw new NotFoundException();
      const [row] = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.memberId, memberId), eq(plans.status, 'active')));
      if (!row) throw new NotFoundException();
      return this.load(tx, row);
    });
  }

  get(gymId: string, caller: Caller, planId: string): Promise<Plan> {
    return withGym(gymId, async (tx) => {
      const { row } = await this.open(tx, gymId, caller, planId, 'read');
      return this.load(tx, row);
    });
  }

  async create(gymId: string, caller: Caller, memberId: string, input: CreatePlan): Promise<Plan> {
    const plan = await withGym(gymId, async (tx) => {
      const access = await this.accessTo(tx, gymId, caller, memberId);
      if (!access) throw new NotFoundException();
      if (access !== 'write') throw new ForbiddenException();
      const [row] = await tx
        .insert(plans)
        .values({
          gymId,
          memberId,
          authorId: caller.userId,
          isTemplate: false,
          kind: 'interactive',
          title: input.title,
          notes: input.notes || null,
          status: 'draft',
        })
        .returning();
      await savePlanTree(tx, gymId, row!.id, input);
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'plan.created',
        entity: 'plan',
        entityId: row!.id,
        data: { ...summaryData(row!), ...counts(input) },
      });
      const current = input.activate ? await this.activateIn(tx, gymId, caller, row!) : row!;
      return this.load(tx, current);
    });
    this.announce(gymId, plan); // a new plan is active only if it was just activated
    return plan;
  }

  update(gymId: string, caller: Caller, planId: string, input: PlanInput): Promise<Plan> {
    return withGym(gymId, async (tx) => {
      const { row } = await this.open(tx, gymId, caller, planId, 'write', true);
      if (row.status === 'archived') throw new ConflictException('An archived plan is read-only');
      if (row.kind !== 'interactive') throw new ConflictException('Not an interactive plan');
      const [updated] = await tx
        .update(plans)
        .set({ title: input.title, notes: input.notes || null, updatedAt: new Date() })
        .where(eq(plans.id, planId))
        .returning();
      await savePlanTree(tx, gymId, planId, input);
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'plan.updated',
        entity: 'plan',
        entityId: planId,
        data: { ...summaryData(updated!), ...counts(input) },
      });
      return this.load(tx, updated!);
    });
  }

  /**
   * A deep copy of a plan into a new template of the caller's own. Needs write access: templates are
   * readable by every trainer of the gym, so a cover (who only reads) must not feed them.
   */
  saveAsTemplate(gymId: string, caller: Caller, planId: string, title: string): Promise<Plan> {
    return withGym(gymId, async (tx) => {
      // Locked, so a concurrent edit of the source cannot tear the copy.
      const { row } = await this.open(tx, gymId, caller, planId, 'write', true);
      if (row.kind !== 'interactive') throw new ConflictException('Only interactive plans');
      const [template] = await tx
        .insert(plans)
        .values({
          gymId,
          memberId: null,
          authorId: caller.userId,
          isTemplate: true,
          kind: 'interactive',
          title,
          notes: row.notes,
          status: 'draft',
        })
        .returning();
      await copyPlanTree(tx, gymId, row.id, template!.id);
      const full = await this.load(tx, template!);
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'template.created',
        entity: 'plan',
        entityId: template!.id,
        data: { title, ...countsOfPlan(full) },
      });
      return full;
    });
  }

  /** A client's plan from a template (deep copy, new ids, no link back); needs write access. */
  async createFromTemplate(
    gymId: string,
    caller: Caller,
    memberId: string,
    input: FromTemplate,
  ): Promise<Plan> {
    const plan = await withGym(gymId, async (tx) => {
      const access = await this.accessTo(tx, gymId, caller, memberId);
      if (!access) throw new NotFoundException();
      if (access !== 'write') throw new ForbiddenException();
      const [template] = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.id, input.templateId), eq(plans.isTemplate, true)))
        .for('share'); // an edit or delete of the template waits for the copy, and the other way round
      if (!template) throw new NotFoundException('No such template');
      const [row] = await tx
        .insert(plans)
        .values({
          gymId,
          memberId,
          authorId: caller.userId,
          isTemplate: false,
          kind: 'interactive',
          title: template.title,
          notes: template.notes,
          status: 'draft',
        })
        .returning();
      await copyPlanTree(tx, gymId, template.id, row!.id);
      const copied = await this.load(tx, row!);
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'plan.created',
        entity: 'plan',
        entityId: row!.id,
        data: { ...summaryData(row!), ...countsOfPlan(copied) },
      });
      const current = input.activate ? await this.activateIn(tx, gymId, caller, row!) : row!;
      return current === row ? copied : this.load(tx, current);
    });
    this.announce(gymId, plan);
    return plan;
  }

  async activate(gymId: string, caller: Caller, planId: string): Promise<Plan> {
    let wasActive = true;
    const plan = await withGym(gymId, async (tx) => {
      const first = await this.open(tx, gymId, caller, planId, 'write');
      // Serialise activations per member, then look again: the plan may have changed meanwhile.
      await lockMemberPlans(tx, first.row.memberId!);
      const [row] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
      if (!row) throw new NotFoundException();
      if (row.status === 'archived') throw new ConflictException('An archived plan stays archived');
      wasActive = row.status === 'active';
      return this.load(tx, await this.activateIn(tx, gymId, caller, row));
    });
    if (!wasActive) this.announce(gymId, plan);
    return plan;
  }

  /**
   * Tells the member their plan is active, after the commit. Only call it for a plan that was just
   * activated (not for edits or a repeat). The key includes the activation time, so a plan that is
   * archived and activated again later is announced again, but a retry of one request is not.
   */
  announce(gymId: string, plan: Plan): void {
    if (plan.status !== 'active' || !plan.memberId || !plan.activatedAt) return;
    this.notifications.dispatch({
      gymId,
      userId: plan.memberId,
      event: 'plan.assigned',
      dedupeKey: `plan:${plan.id}:${new Date(plan.activatedAt).getTime()}`,
      params: { planName: plan.title },
    });
  }

  archive(gymId: string, caller: Caller, planId: string): Promise<void> {
    return withGym(gymId, async (tx) => {
      const { row } = await this.open(tx, gymId, caller, planId, 'write', true);
      if (row.status === 'archived') return;
      await tx
        .update(plans)
        .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(plans.id, planId));
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'plan.archived',
        entity: 'plan',
        entityId: planId,
        data: summaryData(row),
      });
    });
  }

  /**
   * Makes `row` the member's one active plan: the previous one is archived first, in the same
   * transaction. The caller holds the member's plan lock (create takes it here).
   */
  async activateIn(tx: Tx, gymId: string, caller: Caller, row: PlanRow): Promise<PlanRow> {
    await lockMemberPlans(tx, row.memberId!);
    if (row.status === 'active') return row;
    const now = new Date();
    const previous = await tx
      .update(plans)
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(and(eq(plans.memberId, row.memberId!), eq(plans.status, 'active')))
      .returning({ id: plans.id, title: plans.title });
    for (const p of previous) {
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'plan.archived',
        entity: 'plan',
        entityId: p.id,
        data: { title: p.title, memberId: row.memberId, reason: 'replaced' },
      });
    }
    const [activated] = await tx
      .update(plans)
      .set({ status: 'active', activatedAt: now, updatedAt: now })
      .where(eq(plans.id, row.id))
      .returning();
    await this.audit.record(tx, {
      gymId,
      actorId: caller.userId,
      action: 'plan.activated',
      entity: 'plan',
      entityId: row.id,
      data: { ...summaryData(activated!), replacedPlanIds: previous.map((p) => p.id) },
    });
    return activated!;
  }

  async accessTo(tx: Tx, gymId: string, caller: Caller, memberId: string): Promise<PlanAccess> {
    const today = await gymToday(tx, gymId, this.clock.now());
    return planAccess(tx, gymId, caller, memberId, today);
  }

  /**
   * Finds a member's plan the caller may use. Not found, a template, or no read access: 404.
   * A draft is invisible to the member. Read access but `need` is write: 403.
   */
  async open(
    tx: Tx,
    gymId: string,
    caller: Caller,
    planId: string,
    need: 'read' | 'write',
    lock = false,
  ): Promise<{ row: PlanRow; access: PlanAccess }> {
    const query = tx.select().from(plans).where(eq(plans.id, planId));
    const [row] = await (lock ? query.for('update') : query);
    if (!row?.memberId) throw new NotFoundException();
    const access = await this.accessTo(tx, gymId, caller, row.memberId);
    if (!access || (caller.userId === row.memberId && hiddenFromMember(row))) {
      throw new NotFoundException();
    }
    if (need === 'write' && access !== 'write') throw new ForbiddenException();
    return { row, access };
  }

  /** The full plan: days, exercises with their library details, and the author. */
  async load(tx: Tx, row: PlanRow): Promise<Plan> {
    const dayRows = await tx
      .select()
      .from(planDays)
      .where(eq(planDays.planId, row.id))
      .orderBy(asc(planDays.position));
    const exerciseRows = dayRows.length
      ? await tx
          .select({
            pe: planExercises,
            nameEl: exercises.nameEl,
            nameEn: exercises.nameEn,
            muscleGroup: exercises.muscleGroup,
            measure: exercises.measure,
            archivedAt: exercises.archivedAt,
          })
          .from(planExercises)
          .innerJoin(exercises, eq(planExercises.exerciseId, exercises.id))
          .where(
            inArray(
              planExercises.planDayId,
              dayRows.map((d) => d.id),
            ),
          )
          .orderBy(asc(planExercises.position))
      : [];
    const days: PlanDay[] = dayRows.map((d) => ({
      id: d.id,
      title: d.title,
      exercises: exerciseRows
        .filter((e) => e.pe.planDayId === d.id)
        .map((e): PlanExercise => ({
          id: e.pe.id,
          exerciseId: e.pe.exerciseId,
          exercise: {
            nameEl: e.nameEl,
            nameEn: e.nameEn,
            muscleGroup: e.muscleGroup as PlanExercise['exercise']['muscleGroup'],
            measure: e.measure as PlanExercise['exercise']['measure'],
            archived: e.archivedAt !== null,
          },
          sets: e.pe.sets,
          repsMin: e.pe.repsMin,
          repsMax: e.pe.repsMax,
          toFailure: e.pe.toFailure,
          weightKg: e.pe.weightKg === null ? null : Number(e.pe.weightKg),
          restSeconds: e.pe.restSeconds,
          durationSeconds: e.pe.durationSeconds,
          notes: e.pe.notes,
        })),
    }));
    return {
      id: row.id,
      memberId: row.memberId,
      authorId: row.authorId,
      author: await authorOf(row.authorId),
      isTemplate: row.isTemplate,
      kind: row.kind as PlanKind,
      title: row.title,
      notes: row.notes,
      status: row.status as PlanStatus,
      pdfUrl:
        row.kind === 'pdf' && row.pdfObjectKey
          ? await this.storage.signedGetUrl(row.pdfObjectKey)
          : null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      days,
    };
  }
}

function toSummary(r: PlanRow, names: Map<string, string>): PlanSummary {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as PlanKind,
    status: r.status as PlanStatus,
    activatedAt: r.activatedAt?.toISOString() ?? null,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    authorName: r.authorId ? (names.get(r.authorId) ?? null) : null,
    authorId: r.authorId,
  };
}

/**
 * The author may no longer hold a role in the gym, which hides them from gym_app under users RLS,
 * so the name is read through systemDb, for the id the gym's own plan row gave us.
 */
async function authorOf(
  authorId: string | null,
): Promise<{ firstName: string; lastName: string } | null> {
  if (!authorId) return null;
  const [u] = await systemDb
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, authorId));
  return u ?? null;
}

/** One writer at a time per member's plan list (activation archives one plan and activates another). */
export async function lockMemberPlans(tx: Tx, memberId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'plans:' + memberId}, 0))`);
}
