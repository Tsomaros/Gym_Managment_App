import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { type Measurement, type MeasurementInput, MeasurementInputSchema } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MeasurementsService } from './measurements.service';

const callerOf = (req: AppRequest, gym: GymContext) => ({
  userId: req.user!.id,
  roles: gym.roles,
});

/**
 * Body measurements: the primary trainer records and deletes, the member and trainers read
 * (healthAccess; reception and the owner get 404).
 */
@Controller('gyms/:gymId')
export class MeasurementsController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Get(['members/:memberId/measurements', 'me/measurements'])
  @GymRoles('member', 'trainer', 'reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', new ParseUUIDPipe({ optional: true })) memberId: string | undefined,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<Measurement[]> {
    return this.measurements.list(gym.id, callerOf(req, gym), memberId ?? req.user!.id);
  }

  @Post('members/:memberId/measurements')
  @GymRoles('member', 'trainer', 'reception')
  record(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(MeasurementInputSchema)) body: MeasurementInput,
  ): Promise<Measurement> {
    return this.measurements.record(gym.id, callerOf(req, gym), memberId, body);
  }

  @Delete('members/:memberId/measurements/:id')
  @HttpCode(204)
  @GymRoles('member', 'trainer', 'reception')
  remove(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.measurements.remove(gym.id, callerOf(req, gym), memberId, id);
  }
}
