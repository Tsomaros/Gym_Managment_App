import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateShift,
  CreateShiftSchema,
  type CreateShiftSeries,
  CreateShiftSeriesSchema,
  type EndShiftSeries,
  EndShiftSeriesSchema,
  type ExpandedShift,
  isoDateSchema,
  type Occurrence,
  OccurrenceSchema,
  type OnDutyPerson,
  type ScheduleQuery,
  ScheduleQuerySchema,
  type ScheduleResponse,
  type SplitShiftSeries,
  SplitShiftSeriesSchema,
  type UpdateShift,
  UpdateShiftSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CanEditShiftsGuard } from './can-edit-shifts.guard';
import { ShiftsService } from './shifts.service';

@Controller('gyms/:gymId')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('schedule')
  @GymRoles('reception')
  schedule(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(ScheduleQuerySchema)) q: ScheduleQuery,
  ): Promise<ScheduleResponse> {
    return this.shifts.schedule(gym.id, q);
  }

  @Get('me/schedule')
  @GymRoles('trainer', 'reception')
  mySchedule(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Query(new ZodValidationPipe(ScheduleQuerySchema)) q: ScheduleQuery,
  ): Promise<ExpandedShift[]> {
    return this.shifts.mySchedule(gym.id, req.user!.id, q);
  }

  @Get('on-duty')
  @GymRoles('trainer', 'reception')
  onDuty(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<OnDutyPerson[]> {
    return this.shifts.onDuty(gym.id);
  }

  // Writes: @GymRoles runs first (it is applied by the decorator below), then the edit guard.
  @Post('shift-series')
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  createSeries(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateShiftSeriesSchema)) body: CreateShiftSeries,
  ): Promise<{ id: string }> {
    return this.shifts.createSeries(gym.id, req.user!.id, body);
  }

  @Post('shift-series/:id/split')
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  splitSeries(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SplitShiftSeriesSchema)) body: SplitShiftSeries,
  ): Promise<{ id: string }> {
    return this.shifts.splitSeries(gym.id, req.user!.id, id, body);
  }

  @Post('shift-series/:id/end')
  @HttpCode(204)
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  endSeries(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(EndShiftSeriesSchema)) body: EndShiftSeries,
  ): Promise<void> {
    return this.shifts.endSeries(gym.id, req.user!.id, id, body.lastDate);
  }

  @Put('shift-series/:id/occurrences/:date')
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  setOccurrence(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date', new ZodValidationPipe(isoDateSchema)) date: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(OccurrenceSchema)) body: Occurrence,
  ): Promise<{ id: string }> {
    return this.shifts.setOccurrence(gym.id, req.user!.id, id, date, body);
  }

  @Post('shifts')
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  createShift(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateShiftSchema)) body: CreateShift,
  ): Promise<{ id: string }> {
    return this.shifts.createShift(gym.id, req.user!.id, body);
  }

  @Patch('shifts/:id')
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  updateShift(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(UpdateShiftSchema)) body: UpdateShift,
  ): Promise<{ id: string }> {
    return this.shifts.updateShift(gym.id, req.user!.id, id, body);
  }

  @Delete('shifts/:id')
  @HttpCode(204)
  @UseGuards(CanEditShiftsGuard)
  @GymRoles('reception')
  deleteShift(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.shifts.deleteShift(gym.id, req.user!.id, id);
  }
}
