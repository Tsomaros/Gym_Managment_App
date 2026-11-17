import { Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { CheckInResult } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { CheckInService } from './checkin.service';

/** Reception checks a member in by name when the QR code is not an option (spec §6.2). */
@Controller('gyms/:gymId')
export class StaffCheckInController {
  constructor(private readonly checkIns: CheckInService) {}

  @Post('members/:memberId/check-ins')
  @GymRoles('reception')
  checkIn(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<CheckInResult> {
    return this.checkIns.checkIn({
      gymId: gym.id,
      memberId,
      method: 'manual',
      byUserId: req.user!.id,
    });
  }
}
