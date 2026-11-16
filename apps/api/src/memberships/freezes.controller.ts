import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type CreateFreeze, CreateFreezeSchema, type Freeze } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FreezesService } from './freezes.service';

/** Reception sets and ends freezes (spec §5, §6.1). */
@Controller('gyms/:gymId')
export class FreezesController {
  constructor(private readonly freezes: FreezesService) {}

  @Post('memberships/:membershipId/freezes')
  @GymRoles('reception')
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateFreezeSchema)) body: CreateFreeze,
  ): Promise<Freeze> {
    return this.freezes.create(gym.id, req.user!.id, membershipId, body);
  }

  @Post('freezes/:freezeId/end')
  @HttpCode(204)
  @GymRoles('reception')
  end(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('freezeId', ParseUUIDPipe) freezeId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.freezes.end(gym.id, req.user!.id, freezeId);
  }
}
