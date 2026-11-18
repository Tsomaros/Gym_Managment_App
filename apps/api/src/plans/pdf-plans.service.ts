import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Plan } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { plans } from '../db/schema';
import { withGym } from '../db/tenant';
import { StorageService } from '../storage/storage.service';
import { type Caller, PlansService } from './plans.service';

/** The file must start with the PDF signature, whatever its name or the type the client claims. */
export function isPdf(b: Buffer): boolean {
  return b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-';
}

/**
 * PDF workout plans (spec §6.5): the file lives in object storage, never in the database, and is
 * read through a signed link that expires after 5 minutes (spec §8). The object is stored first;
 * if the database change then fails it is removed again, and a replaced object is deleted only
 * after the change commits.
 */
@Injectable()
export class PdfPlansService {
  private readonly log = new Logger(PdfPlansService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
  ) {}

  async create(
    gymId: string,
    caller: Caller,
    memberId: string,
    file: Buffer,
    fields: { title: string; activate: boolean },
  ): Promise<Plan> {
    // Refuse before storing anything when the caller may not write to this member's plans.
    await withGym(gymId, (tx) => this.assertWrite(tx, gymId, caller, memberId));
    if (!isPdf(file)) throw new UnsupportedMediaTypeException('Only PDF files');

    const planId = randomUUID();
    const key = `gyms/${gymId}/plans/${planId}/${randomUUID()}.pdf`;
    let created: Plan;
    try {
      // Inside the try: a put that timed out may still have stored the object.
      await this.storage.put(key, file, 'application/pdf');
      const plan = await withGym(gymId, async (tx) => {
        await this.assertWrite(tx, gymId, caller, memberId); // access may have changed meanwhile
        const [row] = await tx
          .insert(plans)
          .values({
            id: planId,
            gymId,
            memberId,
            authorId: caller.userId,
            isTemplate: false,
            kind: 'pdf',
            title: fields.title,
            status: 'draft',
            pdfObjectKey: key,
          })
          .returning();
        await this.audit.record(tx, {
          gymId,
          actorId: caller.userId,
          action: 'plan.created',
          entity: 'plan',
          entityId: planId,
          data: { title: row!.title, kind: 'pdf', memberId },
        });
        const current = fields.activate
          ? await this.plans.activateIn(tx, gymId, caller, row!)
          : row!;
        return this.plans.load(tx, current);
      });
      created = plan;
    } catch (err) {
      await this.removeQuietly(key); // do not leave an orphan
      throw err;
    }
    this.plans.announce(gymId, created); // after the try: the plan is committed, never remove its file
    return created;
  }

  async replace(gymId: string, caller: Caller, planId: string, file: Buffer): Promise<Plan> {
    await withGym(gymId, async (tx) => {
      const { row } = await this.plans.open(tx, gymId, caller, planId, 'write');
      this.assertReplaceable(row);
    });
    if (!isPdf(file)) throw new UnsupportedMediaTypeException('Only PDF files');

    const key = `gyms/${gymId}/plans/${planId}/${randomUUID()}.pdf`;
    let oldKey: string | null;
    try {
      await this.storage.put(key, file, 'application/pdf');
      const { plan, previous } = await withGym(gymId, async (tx) => {
        const { row } = await this.plans.open(tx, gymId, caller, planId, 'write', true);
        this.assertReplaceable(row);
        const [updated] = await tx
          .update(plans)
          .set({ pdfObjectKey: key, updatedAt: new Date() })
          .where(eq(plans.id, planId))
          .returning();
        await this.audit.record(tx, {
          gymId,
          actorId: caller.userId,
          action: 'plan.updated',
          entity: 'plan',
          entityId: planId,
          data: { title: updated!.title, kind: 'pdf', fileReplaced: true },
        });
        return { plan: await this.plans.load(tx, updated!), previous: row.pdfObjectKey };
      });
      oldKey = previous;
      if (oldKey) await this.removeQuietly(oldKey);
      return plan;
    } catch (err) {
      await this.removeQuietly(key);
      throw err;
    }
  }

  private async assertWrite(
    tx: Parameters<Parameters<typeof withGym>[1]>[0],
    gymId: string,
    caller: Caller,
    memberId: string,
  ): Promise<void> {
    const access = await this.plans.accessTo(tx, gymId, caller, memberId);
    if (!access) throw new NotFoundException();
    if (access !== 'write') throw new ForbiddenException();
  }

  private assertReplaceable(row: typeof plans.$inferSelect): void {
    if (row.kind !== 'pdf') throw new ConflictException('Not a PDF plan');
    if (row.status === 'archived') throw new ConflictException('An archived plan is read-only');
  }

  /** The row already points at the new object; a failed delete only leaves an unreachable one. */
  private async removeQuietly(key: string): Promise<void> {
    await this.storage
      .remove(key)
      .catch((err: Error) => this.log.warn(`Could not delete ${key}: ${err.message}`));
  }
}
