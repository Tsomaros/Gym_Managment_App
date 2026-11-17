import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { type SetTrainer, SetTrainerSchema, type TrainerCover } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CoversService } from './covers.service';

/** Today's cover trainer for a member (spec §6.4). */
@Controller('gyms/:gymId/members/:memberId/cover')
export class CoversController {
  constructor(private readonly covers: CoversService) {}

  @Put()
  @GymRoles('reception')
  assign(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SetTrainerSchema)) body: SetTrainer,
  ): Promise<TrainerCover> {
    return this.covers.assign(gym.id, req.user!.id, memberId, body.trainerId);
  }

  @Delete()
  @HttpCode(204)
  @GymRoles('reception')
  remove(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.covers.remove(gym.id, req.user!.id, memberId);
  }
}
