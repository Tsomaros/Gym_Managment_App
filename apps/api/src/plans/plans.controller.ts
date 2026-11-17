import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  type CreatePlan,
  CreatePlanSchema,
  type Plan,
  type PlanInput,
  PlanInputSchema,
  type PlanSummary,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Caller, PlansService } from './plans.service';

const callerOf = (req: AppRequest, gym: GymContext): Caller => ({
  userId: req.user!.id,
  roles: gym.roles,
});

/**
 * A member's workout plans. Trainers (primary: read and write; cover: read) and the member
 * themself (read) only; the owner and reception have no access (see planAccess).
 */
@Controller('gyms/:gymId')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('members/:memberId/plans')
  @GymRoles('trainer', 'member')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<PlanSummary[]> {
    return this.plans.listForMember(gym.id, callerOf(req, gym), memberId);
  }

  @Get('members/:memberId/plans/active')
  @GymRoles('trainer', 'member')
  active(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<Plan> {
    return this.plans.activeForMember(gym.id, callerOf(req, gym), memberId);
  }

  @Post('members/:memberId/plans')
  @GymRoles('trainer', 'member')
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreatePlanSchema)) body: CreatePlan,
  ): Promise<Plan> {
    return this.plans.create(gym.id, callerOf(req, gym), memberId, body);
  }

  @Get('plans/:planId')
  @GymRoles('trainer', 'member')
  get(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<Plan> {
    return this.plans.get(gym.id, callerOf(req, gym), planId);
  }

  @Put('plans/:planId')
  @GymRoles('trainer', 'member')
  update(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(PlanInputSchema)) body: PlanInput,
  ): Promise<Plan> {
    return this.plans.update(gym.id, callerOf(req, gym), planId, body);
  }

  @Post('plans/:planId/activate')
  @HttpCode(200)
  @GymRoles('trainer', 'member')
  activate(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<Plan> {
    return this.plans.activate(gym.id, callerOf(req, gym), planId);
  }

  @Post('plans/:planId/archive')
  @HttpCode(204)
  @GymRoles('trainer', 'member')
  archive(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.plans.archive(gym.id, callerOf(req, gym), planId);
  }

  /** The signed-in member's own plans. */
  @Get('me/plans')
  @GymRoles('member')
  mine(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<PlanSummary[]> {
    return this.plans.listForMember(gym.id, callerOf(req, gym), req.user!.id);
  }

  @Get('me/plans/active')
  @GymRoles('member')
  myActive(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<Plan> {
    return this.plans.activeForMember(gym.id, callerOf(req, gym), req.user!.id);
  }
}
