import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { Occupancy } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import { GymRoles } from '../access/roles.decorator';
import { levelFor } from './occupancy';
import { PresenceService } from './presence.service';

/** How busy the gym is right now (spec §6.2): the level for members, the count too for staff. */
@Controller('gyms/:gymId/occupancy')
export class OccupancyController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  @GymRoles('member', 'trainer', 'reception')
  async get(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<Occupancy> {
    const { count, capacity, showCount } = await this.presence.countInside(gym.id);
    const isStaff = gym.roles.some((r) => r === 'owner' || r === 'reception' || r === 'trainer');
    if (capacity === null) return isStaff ? { level: null, count } : { level: null };
    const level = levelFor(count, capacity);
    // Members get a number only when the owner switched it on; a body without the keys has no digits.
    return isStaff || showCount ? { level, count, capacity } : { level };
  }
}
