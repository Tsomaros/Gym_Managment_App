import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AttendanceService } from './attendance.service';

const MarkSchema = z.object({ status: z.enum(['attended', 'no_show']) });

@Controller('gyms/:gymId/bookings')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post(':id/attendance')
  @HttpCode(204)
  @GymRoles('trainer', 'reception')
  async mark(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(MarkSchema)) body: z.infer<typeof MarkSchema>,
  ): Promise<void> {
    await this.attendance.mark(gym.id, id, body.status, req.user!.id, gym.roles);
  }
}
