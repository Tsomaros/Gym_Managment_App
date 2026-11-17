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
  Req,
} from '@nestjs/common';
import {
  type FromTemplate,
  FromTemplateSchema,
  type Plan,
  type PlanInput,
  PlanInputSchema,
  type PlanSummary,
  type SaveAsTemplate,
  SaveAsTemplateSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Caller, PlansService } from './plans.service';
import { TemplatesService } from './templates.service';

const callerOf = (req: AppRequest, gym: GymContext): Caller => ({
  userId: req.user!.id,
  roles: gym.roles,
});

/** Plan templates: every trainer of the gym reads them, only the author changes them. */
@Controller('gyms/:gymId')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly plans: PlansService,
  ) {}

  @Get('plan-templates')
  @GymRoles('trainer')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<PlanSummary[]> {
    return this.templates.list(gym.id);
  }

  @Get('plan-templates/:id')
  @GymRoles('trainer')
  get(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
  ): Promise<Plan> {
    return this.templates.get(gym.id, id);
  }

  @Post('plan-templates')
  @GymRoles('trainer')
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(PlanInputSchema)) body: PlanInput,
  ): Promise<Plan> {
    return this.templates.create(gym.id, callerOf(req, gym), body);
  }

  @Put('plan-templates/:id')
  @GymRoles('trainer')
  update(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(PlanInputSchema)) body: PlanInput,
  ): Promise<Plan> {
    return this.templates.update(gym.id, callerOf(req, gym), id, body);
  }

  @Delete('plan-templates/:id')
  @HttpCode(204)
  @GymRoles('trainer')
  remove(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.templates.remove(gym.id, callerOf(req, gym), id);
  }

  @Post('plans/:planId/save-as-template')
  @GymRoles('trainer')
  saveAs(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SaveAsTemplateSchema)) body: SaveAsTemplate,
  ): Promise<Plan> {
    return this.plans.saveAsTemplate(gym.id, callerOf(req, gym), planId, body.title);
  }

  @Post('members/:memberId/plans/from-template')
  @GymRoles('trainer')
  fromTemplate(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(FromTemplateSchema)) body: FromTemplate,
  ): Promise<Plan> {
    return this.plans.createFromTemplate(gym.id, callerOf(req, gym), memberId, body);
  }
}
