import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type CancelClassSession,
  CancelClassSessionSchema,
  type ClassSessionQuery,
  ClassSessionQuerySchema,
  type ClassSessionView,
  type CreateClassSeries,
  CreateClassSeriesSchema,
  type CreateClassSession,
  CreateClassSessionSchema,
  type EndClassSeries,
  EndClassSeriesSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TimetableService } from './timetable.service';

@Controller('gyms/:gymId')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('class-sessions')
  @GymRoles('member', 'trainer', 'reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(ClassSessionQuerySchema)) q: ClassSessionQuery,
  ): Promise<ClassSessionView[]> {
    return this.timetable.list(gym.id, req.user!.id, q);
  }

  @Post('class-series')
  @GymRoles('owner')
  createSeries(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateClassSeriesSchema)) body: CreateClassSeries,
  ): Promise<{ id: string }> {
    return this.timetable.createSeries(gym.id, req.user!.id, body);
  }

  @Post('class-series/:id/end')
  @HttpCode(204)
  @GymRoles('owner')
  async endSeries(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(EndClassSeriesSchema)) body: EndClassSeries,
  ): Promise<void> {
    await this.timetable.endSeries(gym.id, req.user!.id, id, body.lastDate);
  }

  @Post('class-sessions')
  @GymRoles('owner')
  createSession(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateClassSessionSchema)) body: CreateClassSession,
  ): Promise<{ id: string }> {
    return this.timetable.createSession(gym.id, req.user!.id, body);
  }

  @Post('class-sessions/:id/cancel')
  @HttpCode(204)
  @GymRoles('reception')
  async cancel(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CancelClassSessionSchema)) body: CancelClassSession,
  ): Promise<void> {
    await this.timetable.cancelSession(gym.id, req.user!.id, id, body.reason);
  }
}
