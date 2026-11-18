import { Injectable } from '@nestjs/common';
import type { CreateGym } from '@gym/shared';
import { systemDb } from '../db/client';
import { gyms } from '../db/schema';
import { seedExercises } from '../exercises/seed-exercises';
import { InvitationsService } from '../invitations/invitations.service';

@Injectable()
export class GymsService {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * Platform admin only. The gym and its owner invitation are created together through systemDb,
   * the one place a gym is written before any gym context exists. The email goes out after commit;
   * if it fails the gym still exists (mailSent: false) and the owner can be re-invited.
   */
  async create(body: CreateGym, adminId: string): Promise<{ gymId: string; mailSent: boolean }> {
    const { gymId, rawToken } = await systemDb.transaction(async (tx) => {
      const [gym] = await tx
        .insert(gyms)
        .values({ name: body.name, timezone: body.timezone })
        .returning({ id: gyms.id });
      await seedExercises(tx, gym!.id);
      const { rawToken } = await this.invitations.issue(tx, {
        gymId: gym!.id,
        email: body.ownerEmail,
        firstName: body.ownerFirstName,
        lastName: body.ownerLastName,
        roles: ['owner'],
        invitedBy: adminId,
      });
      return { gymId: gym!.id, rawToken };
    });

    const mailSent = await this.invitations.sendInviteMail({
      email: body.ownerEmail,
      firstName: body.ownerFirstName,
      gymName: body.name,
      rawToken,
    });
    return { gymId, mailSent };
  }
}
