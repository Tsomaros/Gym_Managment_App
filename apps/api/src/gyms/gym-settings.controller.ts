import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import {
  type GymSettings,
  type UpdateGymSettings,
  UpdateGymSettingsSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GymSettingsService } from './gym-settings.service';

@Controller('gyms/:gymId/settings')
export class GymSettingsController {
  constructor(private readonly settings: GymSettingsService) {}

  @Get()
  @GymRoles('reception')
  get(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<GymSettings> {
    return this.settings.get(gym.id);
  }

  @Patch()
  @GymRoles('owner')
  update(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(UpdateGymSettingsSchema)) body: UpdateGymSettings,
  ): Promise<GymSettings> {
    return this.settings.update(gym.id, req.user!.id, body);
  }
}
