import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import {
  type AttendancePoint,
  type ExerciseProgress,
  type ProgressExerciseOption,
  type ProgressQuery,
  ProgressQuerySchema,
  type VolumePoint,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Caller, ProgressService } from './progress.service';

const callerOf = (req: AppRequest, gym: GymContext): Caller => ({
  userId: req.user!.id,
  roles: gym.roles,
});
const optionalUuid = new ParseUUIDPipe({ optional: true });

/**
 * Progress charts of a member: the member and their trainers read (see healthAccess). Reception
 * and the owner pass the role guard on purpose so healthAccess answers them with 404, not 403.
 */
@Controller('gyms/:gymId')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get(['members/:memberId/progress/exercises', 'me/progress/exercises'])
  @GymRoles('member', 'trainer', 'reception')
  exercises(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<ProgressExerciseOption[]> {
    return this.progress.exerciseOptions(gym.id, callerOf(req, gym), memberId ?? req.user!.id);
  }

  @Get(['members/:memberId/progress/exercises/:exerciseId', 'me/progress/exercises/:exerciseId'])
  @GymRoles('member', 'trainer', 'reception')
  exercise(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(ProgressQuerySchema)) q: ProgressQuery,
  ): Promise<ExerciseProgress> {
    return this.progress.exerciseProgress(
      gym.id,
      callerOf(req, gym),
      memberId ?? req.user!.id,
      exerciseId,
      q.weeks,
    );
  }

  @Get(['members/:memberId/progress/volume', 'me/progress/volume'])
  @GymRoles('member', 'trainer', 'reception')
  volume(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(ProgressQuerySchema)) q: ProgressQuery,
  ): Promise<VolumePoint[]> {
    return this.progress.volume(gym.id, callerOf(req, gym), memberId ?? req.user!.id, q.weeks);
  }

  @Get(['members/:memberId/progress/attendance', 'me/progress/attendance'])
  @GymRoles('member', 'trainer', 'reception')
  attendance(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(ProgressQuerySchema)) q: ProgressQuery,
  ): Promise<AttendancePoint[]> {
    return this.progress.attendance(gym.id, callerOf(req, gym), memberId ?? req.user!.id, q.weeks);
  }
}
