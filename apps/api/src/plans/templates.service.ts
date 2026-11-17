import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Plan, PlanInput, PlanSummary } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { namesOf } from '../common/names';
import { plans } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { type Caller, countsOfPlan, PlansService } from './plans.service';
import { savePlanTree } from './save-plan';

type PlanRow = typeof plans.$inferSelect;

/**
 * The gym's plan templates (spec §6.5): visible to every trainer, changed or deleted only by the
 * trainer who made them. A template is a plan without a member, always a draft.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly audit: AuditService,
    private readonly plans: PlansService,
  ) {}

  list(gymId: string): Promise<PlanSummary[]> {
    return withGym(gymId, async (tx) => {
      const rows = await tx
        .select()
        .from(plans)
        .where(eq(plans.isTemplate, true))
        .orderBy(desc(plans.updatedAt));
      const names = await namesOf(rows.map((r) => r.authorId));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: 'interactive' as const,
        status: 'draft' as const,
        activatedAt: null,
        archivedAt: null,
        authorName: r.authorId ? (names.get(r.authorId) ?? null) : null,
      }));
    });
  }

  get(gymId: string, templateId: string): Promise<Plan> {
    return withGym(gymId, async (tx) => this.plans.load(tx, await this.find(tx, templateId)));
  }

  create(gymId: string, caller: Caller, input: PlanInput): Promise<Plan> {
    return withGym(gymId, async (tx) => {
      const [row] = await tx
        .insert(plans)
        .values({
          gymId,
          memberId: null,
          authorId: caller.userId,
          isTemplate: true,
          kind: 'interactive',
          title: input.title,
          notes: input.notes || null,
          status: 'draft',
        })
        .returning();
      await savePlanTree(tx, gymId, row!.id, input);
      const full = await this.plans.load(tx, row!);
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'template.created',
        entity: 'plan',
        entityId: row!.id,
        data: { title: row!.title, ...countsOfPlan(full) },
      });
      return full;
    });
  }

  update(gymId: string, caller: Caller, templateId: string, input: PlanInput): Promise<Plan> {
    return withGym(gymId, async (tx) => {
      const current = await this.find(tx, templateId, true);
      this.assertAuthor(current, caller);
      const [row] = await tx
        .update(plans)
        .set({ title: input.title, notes: input.notes || null, updatedAt: new Date() })
        .where(eq(plans.id, templateId))
        .returning();
      await savePlanTree(tx, gymId, templateId, input);
      const full = await this.plans.load(tx, row!);
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'template.updated',
        entity: 'plan',
        entityId: templateId,
        data: { title: row!.title, ...countsOfPlan(full) },
      });
      return full;
    });
  }

  remove(gymId: string, caller: Caller, templateId: string): Promise<void> {
    return withGym(gymId, async (tx) => {
      const current = await this.find(tx, templateId, true);
      this.assertAuthor(current, caller);
      await tx.delete(plans).where(eq(plans.id, templateId)); // days and exercises cascade
      await this.audit.record(tx, {
        gymId,
        actorId: caller.userId,
        action: 'template.deleted',
        entity: 'plan',
        entityId: templateId,
        data: { title: current.title },
      });
    });
  }

  /** A template, or 404: a client's plan id is never served by the template routes. */
  private async find(tx: Tx, templateId: string, lock = false): Promise<PlanRow> {
    const query = tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, templateId), eq(plans.isTemplate, true)));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException();
    return row;
  }

  private assertAuthor(row: PlanRow, caller: Caller): void {
    if (row.authorId !== caller.userId) throw new ForbiddenException('Only the author');
  }
}
