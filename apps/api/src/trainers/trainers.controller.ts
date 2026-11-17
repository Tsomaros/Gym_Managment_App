import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import {
  type MemberTrainer,
  type SetTrainer,
  SetTrainerSchema,
  type TrainerClient,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TrainersService } from './trainers.service';

@Controller('gyms/:gymId')
export class TrainersController {
  constructor(private readonly trainers: TrainersService) {}

  @Put('members/:memberId/trainer')
  @GymRoles('reception')
  assign(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SetTrainerSchema)) body: SetTrainer,
  ): Promise<MemberTrainer> {
    return this.trainers.assign(gym.id, req.user!.id, memberId, body.trainerId);
  }

  @Delete('members/:memberId/trainer')
  @HttpCode(204)
  @GymRoles('reception')
  unassign(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.trainers.unassign(gym.id, req.user!.id, memberId);
  }

  @Get('trainer/clients')
  @GymRoles('trainer')
  clients(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<TrainerClient[]> {
    return this.trainers.clients(gym.id, req.user!.id);
  }
}
