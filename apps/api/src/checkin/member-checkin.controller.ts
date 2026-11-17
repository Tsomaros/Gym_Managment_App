import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import type { CheckInTokenResponse } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { Clock } from '../common/clock';
import { signCheckInToken } from './checkin-token';

/** The member's own rotating check-in QR payload (spec §6.2). */
@Controller('gyms/:gymId')
export class MemberCheckInController {
  constructor(private readonly clock: Clock) {}

  @Get('me/check-in-token')
  @GymRoles('member')
  token(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): CheckInTokenResponse {
    const { token, expiresAt } = signCheckInToken(
      { memberId: req.user!.id, gymId: gym.id },
      this.clock.now(),
    );
    return { token, expiresAt: expiresAt.toISOString() };
  }
}
