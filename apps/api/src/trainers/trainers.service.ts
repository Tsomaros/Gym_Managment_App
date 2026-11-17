import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MemberTrainer, TrainerClient } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { gymRoles, memberTrainers, trainerCovers, users } from '../db/schema';
import { type Tx, withGym } from '../db/tenant';
import { memberStatus } from '../members/member-status';
import { PhotosService } from '../members/photos.service';
import { gymToday, membershipsOf } from '../memberships/memberships.service';
import { hasTrainerMembership, lockTrainer } from './trainer-access';

@Injectable()
export class TrainersService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly photos: PhotosService,
  ) {}

  /** Sets (or replaces) the member's primary trainer. */
  async assign(
    gymId: string,
    actorId: string,
    memberId: string,
    trainerId: string,
  ): Promise<MemberTrainer> {
    return withGym(gymId, async (tx) => {
      await lockTrainer(tx, trainerId);
      const [trainer] = await tx
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(and(eq(gymRoles.userId, trainerId), eq(gymRoles.role, 'trainer')));
      if (!trainer) throw new NotFoundException('No such trainer');
      const [isMember] = await tx
        .select({ id: gymRoles.userId })
        .from(gymRoles)
        .where(and(eq(gymRoles.userId, memberId), eq(gymRoles.role, 'member')));
      if (!isMember) throw new NotFoundException('Not a member of this gym');
      if (trainerId === memberId) {
        throw new BadRequestException('A trainer cannot train themselves');
      }

      const today = await gymToday(tx, gymId, this.clock.now());
      const ms = (await membershipsOf(tx, [memberId], today)).get(memberId) ?? [];
      if (!hasTrainerMembership(ms)) {
        throw new ConflictException('No membership with personal training');
      }

      const [previous] = await tx
        .select({ trainerId: memberTrainers.trainerId })
        .from(memberTrainers)
        .where(eq(memberTrainers.memberId, memberId))
        .for('update');
      await tx
        .insert(memberTrainers)
        .values({ gymId, memberId, trainerId, assignedBy: actorId })
        .onConflictDoUpdate({
          target: [memberTrainers.gymId, memberTrainers.memberId],
          set: { trainerId, assignedAt: new Date(), assignedBy: actorId },
        });
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'trainer.assigned',
        entity: 'user',
        entityId: memberId,
        data: { trainerId, previousTrainerId: previous?.trainerId ?? null },
      });
      return {
        userId: trainer.id,
        firstName: trainer.firstName,
        lastName: trainer.lastName,
        paused: false,
      };
    });
  }

  async unassign(gymId: string, actorId: string, memberId: string): Promise<void> {
    await withGym(gymId, async (tx) => {
      const [removed] = await tx
        .delete(memberTrainers)
        .where(eq(memberTrainers.memberId, memberId))
        .returning({ trainerId: memberTrainers.trainerId });
      if (!removed) throw new NotFoundException();
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'trainer.unassigned',
        entity: 'user',
        entityId: memberId,
        data: { trainerId: removed.trainerId },
      });
    });
  }

  /** The trainer's primary clients, paused ones last. */
  async clients(gymId: string, trainerId: string): Promise<TrainerClient[]> {
    return withGym(gymId, async (tx) => {
      const today = await gymToday(tx, gymId, this.clock.now());
      const rows = await tx
        .select({
          memberId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          assignedAt: memberTrainers.assignedAt,
        })
        .from(memberTrainers)
        .innerJoin(users, eq(users.id, memberTrainers.memberId))
        .where(eq(memberTrainers.trainerId, trainerId));
      const covers = await tx
        .select({
          memberId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          assignedAt: trainerCovers.createdAt,
        })
        .from(trainerCovers)
        .innerJoin(users, eq(users.id, trainerCovers.memberId))
        .where(and(eq(trainerCovers.trainerId, trainerId), eq(trainerCovers.date, today)));
      const ids = [...rows, ...covers].map((r) => r.memberId);
      const byMember = await membershipsOf(tx, ids, today);
      const photoUrls = await this.photos.urlsFor(tx, ids);
      const list = rows.map((r): TrainerClient => {
        const ms = byMember.get(r.memberId) ?? [];
        return {
          memberId: r.memberId,
          firstName: r.firstName,
          lastName: r.lastName,
          photoUrl: photoUrls.get(r.memberId) ?? null,
          paused: !hasTrainerMembership(ms),
          membershipStatus: memberStatus(ms).status,
          assignedAt: r.assignedAt.toISOString(),
        };
      });
      // A member who is already an unpaused primary client shows once (trainerAccess: primary wins).
      const primaryIds = new Set(list.filter((c) => !c.paused).map((c) => c.memberId));
      const coverList = covers
        .filter((r) => !primaryIds.has(r.memberId))
        .map((r): TrainerClient => ({
          memberId: r.memberId,
          firstName: r.firstName,
          lastName: r.lastName,
          photoUrl: photoUrls.get(r.memberId) ?? null,
          paused: false,
          membershipStatus: memberStatus(byMember.get(r.memberId) ?? []).status,
          assignedAt: r.assignedAt.toISOString(),
          cover: true,
        }));
      return list
        .sort(
          (a, b) =>
            Number(a.paused) - Number(b.paused) ||
            a.firstName.localeCompare(b.firstName, 'el') ||
            a.lastName.localeCompare(b.lastName, 'el'),
        )
        .concat(coverList);
    });
  }

  /** For role removal (inside its transaction): ends all primary links of this trainer. */
  async removeLinksOf(tx: Tx, gymId: string, actorId: string, trainerId: string): Promise<void> {
    const removed = await tx
      .delete(memberTrainers)
      .where(eq(memberTrainers.trainerId, trainerId))
      .returning({ memberId: memberTrainers.memberId });
    for (const r of removed) {
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'trainer.unassigned',
        entity: 'user',
        entityId: r.memberId,
        data: { trainerId, reason: 'role_removed' },
      });
    }
  }
}
