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
  receptionCanEditShifts: gyms.receptionCanEditShifts,
  reminderDays: gyms.reminderDays,
  capacity: gyms.capacity,
  showOccupancyCount: gyms.showOccupancyCount,
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
        .select(settingsColumns)
        .from(gyms)
        .where(eq(gyms.id, gymId))
        .for('update');
      if (!before) throw new NotFoundException();
      const [g] = await tx
        .update(gyms)
        .set({
          ...(body.autoCheckoutMinutes !== undefined && {
            autoCheckoutMinutes: body.autoCheckoutMinutes,
          }),
          ...(body.reminderDays !== undefined && { reminderDays: body.reminderDays }),
          ...(body.capacity !== undefined && { capacity: body.capacity }),
          ...(body.showOccupancyCount !== undefined && {
            showOccupancyCount: body.showOccupancyCount,
          }),
          ...(body.receptionCanEditShifts !== undefined && {
            receptionCanEditShifts: body.receptionCanEditShifts,
          }),
        })
        .where(eq(gyms.id, gymId))
        .returning(settingsColumns);
      const record = (data: Record<string, unknown>) =>
        this.audit.record(tx, {
          gymId,
          actorId,
          action: 'gym.settings_updated',
          entity: 'gym',
          entityId: gymId,
          data,
        });
      if (body.autoCheckoutMinutes !== undefined) {
        await record({ from: before.autoCheckoutMinutes, to: body.autoCheckoutMinutes });
      }
      if (body.receptionCanEditShifts !== undefined) {
        await record({
          setting: 'receptionCanEditShifts',
          from: before.receptionCanEditShifts,
          to: body.receptionCanEditShifts,
        });
      }
      if (body.reminderDays !== undefined) {
        await record({
          setting: 'reminderDays',
          from: before.reminderDays,
          to: body.reminderDays,
        });
      }
      if (body.capacity !== undefined) {
        await record({ setting: 'capacity', from: before.capacity, to: body.capacity });
      }
      if (body.showOccupancyCount !== undefined) {
        await record({
          setting: 'showOccupancyCount',
          from: before.showOccupancyCount,
          to: body.showOccupancyCount,
        });
      }
      return g!;
    });
  }
}
