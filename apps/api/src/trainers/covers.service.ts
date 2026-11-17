import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TrainerCover } from '@gym/shared';
import { and, eq, gte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { gymRoles, memberTrainers, trainerCovers } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { ShiftsService } from '../shifts/shifts.service';
import { gymToday } from '../memberships/memberships.service';
import { lockTrainer } from './trainer-access';

@Injectable()
export class CoversService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly shifts: ShiftsService,
  ) {}

  /**
   * Assigns a trainer who is on duty right now as the member's cover for today (gym date),
   * replacing today's cover. Not the member's own primary trainer. No trainer membership needed:
   * a cover only reads (spec §6.4).
   */
  async assign(
    gymId: string,
    actorId: string,
    memberId: string,
    trainerId: string,
  ): Promise<TrainerCover> {
    return withGym(gymId, async (tx) => {
      await lockTrainer(tx, trainerId);
      if (trainerId === memberId)
        throw new BadRequestException('A trainer cannot cover themselves');
      const [trainer] = await tx
        .select({ id: gymRoles.userId })
        .from(gymRoles)
        .where(and(eq(gymRoles.userId, trainerId), eq(gymRoles.role, 'trainer')));
      if (!trainer) throw new NotFoundException('No such trainer');
      const [isMember] = await tx
        .select({ id: gymRoles.userId })
        .from(gymRoles)
        .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
      if (!isMember) throw new NotFoundException('Not a member of this gym');

      const [primary] = await tx
        .select({ trainerId: memberTrainers.trainerId })
        .from(memberTrainers)
        .where(eq(memberTrainers.memberId, memberId));
      if (primary?.trainerId === trainerId) {
        throw new BadRequestException('This is already the primary trainer');
      }
      if (!(await this.shifts.staffOnDutyNow(tx, gymId, [trainerId])).has(trainerId)) {
        throw new ConflictException('Trainer not on duty');
      }

      const today = await gymToday(tx, gymId, this.clock.now());
      const [previous] = await tx
        .select({ trainerId: trainerCovers.trainerId })
        .from(trainerCovers)
        .where(and(eq(trainerCovers.memberId, memberId), eq(trainerCovers.date, today)))
        .for('update');
      await tx
        .insert(trainerCovers)
        .values({ gymId, memberId, trainerId, date: today, assignedBy: actorId })
        .onConflictDoUpdate({
          target: [trainerCovers.gymId, trainerCovers.memberId, trainerCovers.date],
          set: { trainerId, assignedBy: actorId, createdAt: new Date() },
        });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'cover.assigned',
        entity: 'user',
        entityId: memberId,
        data: { trainerId, date: today, previousTrainerId: previous?.trainerId ?? null },
      });
      return { memberId, trainerId, date: today };
    });
  }

  /** Removes today's cover; 404 when there is none. */
  async remove(gymId: string, actorId: string, memberId: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const today = await gymToday(tx, gymId, this.clock.now());
      const [removed] = await tx
        .delete(trainerCovers)
        .where(and(eq(trainerCovers.memberId, memberId), eq(trainerCovers.date, today)))
        .returning({ trainerId: trainerCovers.trainerId });
      if (!removed) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'cover.removed',
        entity: 'user',
        entityId: memberId,
        data: { trainerId: removed.trainerId, date: today },
      });
    });
  }

  /** For role removal (inside its transaction): deletes this trainer's covers dated today or later. */
  async removeCoversOf(tx: Tx, gymId: string, actorId: string, trainerId: string): Promise<void> {
    const today = await gymToday(tx, gymId, this.clock.now());
    const removed = await tx
      .delete(trainerCovers)
      .where(and(eq(trainerCovers.trainerId, trainerId), gte(trainerCovers.date, today)))
      .returning({ memberId: trainerCovers.memberId, date: trainerCovers.date });
    for (const r of removed) {
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'cover.removed',
        entity: 'user',
        entityId: r.memberId,
        data: { trainerId, date: r.date, reason: 'role_removed' },
      });
    }
  }
}
