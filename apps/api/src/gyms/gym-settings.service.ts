import { Injectable, NotFoundException } from '@nestjs/common';
import type { GymSettings, UpdateGymSettings } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { gyms } from '../db/schema';
import { withGym } from '../db/tenant';

const settingsColumns = {
  name: gyms.name,
  timezone: gyms.timezone,
  autoCheckoutMinutes: gyms.autoCheckoutMinutes,
};

@Injectable()
export class GymSettingsService {
  constructor(private readonly audit: AuditService) {}

  async get(gymId: string): Promise<GymSettings> {
    const [g] = await withGym(gymId, (tx) =>
      tx.select(settingsColumns).from(gyms).where(eq(gyms.id, gymId)),
    );
    if (!g) throw new NotFoundException();
    return g;
  }

  async update(gymId: string, actorId: string, body: UpdateGymSettings): Promise<GymSettings> {
    return withGym(gymId, async (tx) => {
      const [before] = await tx
        .select({ minutes: gyms.autoCheckoutMinutes })
        .from(gyms)
        .where(eq(gyms.id, gymId))
        .for('update');
      if (!before) throw new NotFoundException();
      const [g] = await tx
        .update(gyms)
        .set({ autoCheckoutMinutes: body.autoCheckoutMinutes })
        .where(eq(gyms.id, gymId))
        .returning(settingsColumns);
      await this.audit.record(tx, {
        gymId,
        actorId,
        action: 'gym.settings_updated',
        entity: 'gym',
        entityId: gymId,
        data: { from: before.minutes, to: body.autoCheckoutMinutes },
      });
      return g!;
    });
  }
}
