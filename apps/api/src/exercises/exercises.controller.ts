import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type Exercise,
  type ExerciseInput,
  ExerciseInputSchema,
  type ExercisePatch,
  ExercisePatchSchema,
  type ExerciseQuery,
  ExerciseQuerySchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExercisesService } from './exercises.service';

/** The gym's exercise library (trainers and the owner). */
@Controller('gyms/:gymId/exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @GymRoles('trainer', 'owner')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(ExerciseQuerySchema)) query: ExerciseQuery,
  ): Promise<Exercise[]> {
    return this.exercises.list(gym.id, query);
  }

  @Post()
  @GymRoles('trainer', 'owner')
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(ExerciseInputSchema)) body: ExerciseInput,
  ): Promise<Exercise> {
    return this.exercises.create(gym.id, req.user!.id, body);
  }

  @Patch(':id')
  @GymRoles('trainer', 'owner')
  update(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(ExercisePatchSchema)) body: ExercisePatch,
  ): Promise<Exercise> {
    return this.exercises.update(gym.id, req.user!.id, id, body);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @GymRoles('trainer', 'owner')
  archive(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.exercises.archive(gym.id, req.user!.id, gym.roles, id);
  }
}
