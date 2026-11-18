import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type LastPerformance,
  type LastPerformanceQuery,
  LastPerformanceQuerySchema,
  type SessionListQuery,
  SessionListQuerySchema,
  type SessionUpsert,
  SessionUpsertSchema,
  type SetUpsert,
  SetUpsertSchema,
  type WorkoutSession,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Caller, WorkoutsService } from './workouts.service';

const callerOf = (req: AppRequest, gym: GymContext): Caller => ({
  userId: req.user!.id,
  roles: gym.roles,
});

/** `/me/...` is the signed-in person; `/members/:memberId/...` names the member. */
const optionalUuid = new ParseUUIDPipe({ optional: true });

/**
 * A member's workout log. The member logs; their trainers read (see healthAccess). Reception
 * and the owner pass the role guard on purpose so healthAccess answers them with 404, not 403.
 */
@Controller('gyms/:gymId')
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Put(['members/:memberId/sessions/:sessionId', 'me/sessions/:sessionId'])
  @GymRoles('member', 'trainer', 'reception')
  putSession(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SessionUpsertSchema)) body: SessionUpsert,
  ): Promise<WorkoutSession> {
    return this.workouts.upsertSession(
      gym.id,
      callerOf(req, gym),
      memberId ?? req.user!.id,
      sessionId,
      body,
    );
  }

  @Put(['members/:memberId/sessions/:sessionId/sets/:setId', 'me/sessions/:sessionId/sets/:setId'])
  @GymRoles('member', 'trainer', 'reception')
  async putSet(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('setId', ParseUUIDPipe) setId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SetUpsertSchema)) body: SetUpsert,
  ): Promise<void> {
    await this.workouts.upsertSet(
      gym.id,
      callerOf(req, gym),
      memberId ?? req.user!.id,
      sessionId,
      setId,
      body,
    );
  }

  @Delete([
    'members/:memberId/sessions/:sessionId/sets/:setId',
    'me/sessions/:sessionId/sets/:setId',
  ])
  @HttpCode(204)
  @GymRoles('member', 'trainer', 'reception')
  deleteSet(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('setId', ParseUUIDPipe) setId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.workouts.deleteSet(
      gym.id,
      callerOf(req, gym),
      memberId ?? req.user!.id,
      sessionId,
      setId,
    );
  }

  @Post(['members/:memberId/sessions/:sessionId/finish', 'me/sessions/:sessionId/finish'])
  @HttpCode(200)
  @GymRoles('member', 'trainer', 'reception')
  finish(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<WorkoutSession> {
    return this.workouts.finish(gym.id, callerOf(req, gym), memberId ?? req.user!.id, sessionId);
  }

  @Get(['members/:memberId/sessions', 'me/sessions'])
  @GymRoles('member', 'trainer', 'reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(SessionListQuerySchema)) query: SessionListQuery,
  ): Promise<WorkoutSession[]> {
    return this.workouts.list(gym.id, callerOf(req, gym), memberId ?? req.user!.id, query);
  }

  @Get(['members/:memberId/last-performance', 'me/last-performance'])
  @GymRoles('member', 'trainer', 'reception')
  lastPerformance(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', optionalUuid) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(LastPerformanceQuerySchema)) query: LastPerformanceQuery,
  ): Promise<LastPerformance[]> {
    return this.workouts.lastPerformance(
      gym.id,
      callerOf(req, gym),
      memberId ?? req.user!.id,
      query.exerciseIds,
    );
  }
}
