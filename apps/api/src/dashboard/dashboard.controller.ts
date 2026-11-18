import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { Dashboard } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import { GymRoles } from '../access/roles.decorator';
import { DashboardService } from './dashboard.service';

/** The owner's numbers: income, members and busy hours (spec §6.9). Owner only. */
@Controller('gyms/:gymId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @GymRoles('owner')
  get(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<Dashboard> {
    return this.dashboard.get(gym.id);
  }
}
