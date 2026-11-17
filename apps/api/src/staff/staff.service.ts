import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PendingInvitation, StaffList, StaffMember, StaffRole } from '@gym/shared';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { gymRoles, invitations, users } from '../db/schema';
import { withGym } from '../db/tenant';
import { lockTrainer } from '../trainers/trainer-access';
import { CoversService } from '../trainers/covers.service';
import { TrainersService } from '../trainers/trainers.service';
import { ShiftsService } from '../shifts/shifts.service';

const STAFF: StaffRole[] = ['owner', 'reception', 'trainer'];

@Injectable()
export class StaffService {
  constructor(
    private readonly audit: AuditService,
    private readonly shifts: ShiftsService,
    private readonly trainers: TrainersService,
    private readonly covers: CoversService,
  ) {}

  /** Everyone with a staff role (member-only people are not listed), plus pending staff invites for the owner. */
  async list(gymId: string, isOwner: boolean): Promise<StaffList> {
    return withGym(gymId, async (tx) => {
      const rows = await tx
        .select({
          userId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phone: users.phone,
          role: gymRoles.role,
          createdAt: gymRoles.createdAt,
        })
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .where(inArray(gymRoles.role, STAFF))
        .orderBy(asc(users.firstName), asc(users.lastName), asc(users.id));

      const byUser = new Map<string, StaffMember>();
      for (const r of rows) {
        const existing = byUser.get(r.userId);
        if (existing) {
          existing.roles.push(r.role as StaffRole);
          if (r.createdAt.toISOString() < existing.since)
            existing.since = r.createdAt.toISOString();
        } else {
          byUser.set(r.userId, {
            userId: r.userId,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            phone: r.phone,
            roles: [r.role as StaffRole],
            since: r.createdAt.toISOString(),
          });
        }
      }

      let pending: PendingInvitation[] = [];
      if (isOwner) {
        const inv = await tx
          .select()
          .from(invitations)
          .where(
            and(
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, sql`now()`),
              sql`${invitations.roles} && array['owner','reception','trainer']::text[]`,
            ),
          )
          .orderBy(asc(invitations.createdAt));
        pending = inv.map((i) => ({
          id: i.id,
          email: i.email,
          firstName: i.firstName,
          lastName: i.lastName,
          roles: i.roles,
          expiresAt: i.expiresAt.toISOString(),
        }));
      }
      return { staff: [...byUser.values()], pending };
    });
  }

  /**
   * Removes one staff role from a person. The person's other roles and member data stay.
   * Removing an owner role locks the gym's owner rows first, so two owners removing each other
   * at once can't leave the gym without an owner.
   */
  async removeRole(gymId: string, actorId: string, userId: string, role: StaffRole): Promise<void> {
    if (!STAFF.includes(role))
      throw new BadRequestException('Only staff roles can be removed here');
    await withGym(gymId, async (tx) => {
      if (role === 'trainer') await lockTrainer(tx, userId);
      if (role === 'owner') {
        const owners = await tx
          .select({ userId: gymRoles.userId })
          .from(gymRoles)
          .where(eq(gymRoles.role, 'owner'))
          .for('update');
        if (!owners.some((o) => o.userId === userId)) throw new NotFoundException();
        if (owners.length <= 1) throw new ConflictException('A gym needs at least one owner');
      }
      const removed = await tx
        .delete(gymRoles)
        .where(and(eq(gymRoles.userId, userId), eq(gymRoles.role, role)))
        .returning({ userId: gymRoles.userId });
      if (!removed.length) throw new NotFoundException();

      // PHASE3-REMOVAL-HOOKS: removing the trainer role also ends their primary links (Task 4)
      // and covers (Task 5).
      if (role === 'trainer') await this.trainers.removeLinksOf(tx, gymId, actorId, userId);
      if (role === 'trainer') await this.covers.removeCoversOf(tx, gymId, actorId, userId);
      // Shifts go when the trainer role is removed, or when the person is left with no staff role.
      const [stillStaff] = await tx
        .select({ role: gymRoles.role })
        .from(gymRoles)
        .where(and(eq(gymRoles.userId, userId), inArray(gymRoles.role, STAFF)))
        .limit(1);
      if (role === 'trainer' || !stillStaff)
        await this.shifts.removeFutureShifts(tx, gymId, userId);

      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'staff.role_removed',
        entity: 'user',
        entityId: userId,
        data: { role },
      });
    });
  }
}
