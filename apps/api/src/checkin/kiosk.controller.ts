import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { type KioskCheckIn, KioskCheckInSchema, type KioskCheckInResult } from '@gym/shared';
import { ThrottleKiosk } from '../auth/throttle';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentDevice, type CurrentDeviceInfo } from '../devices/device.guard';
import { verifyCheckInToken } from './checkin-token';
import { CheckInService } from './checkin.service';

const REFUSED: KioskCheckInResult = { valid: false, firstName: null, reason: 'invalid_token' };

/** The kiosk tablet scans a member's QR code (spec §6.2). */
@Controller('kiosk')
export class KioskCheckInController {
  constructor(
    private readonly checkIns: CheckInService,
    private readonly clock: Clock,
  ) {}

  /**
   * Always 200 with a verdict the tablet can show. A bad, expired or other-gym token, or a person
   * who is not a member here, records nothing. The tablet learns only the first name.
   */
  @Post('check-in')
  @HttpCode(200)
  @ThrottleKiosk()
  async checkIn(
    @CurrentDevice() device: CurrentDeviceInfo,
    @Body(new ZodValidationPipe(KioskCheckInSchema)) body: KioskCheckIn,
  ): Promise<KioskCheckInResult> {
    const claims = verifyCheckInToken(body.token, this.clock.now());
    if (!claims || claims.gymId !== device.gymId) return REFUSED;
    try {
      const r = await this.checkIns.checkIn({
        gymId: device.gymId,
        memberId: claims.memberId,
        method: 'kiosk',
        deviceId: device.id,
      });
      return { valid: r.valid, firstName: r.member.firstName, reason: r.reason };
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { valid: false, firstName: null, reason: 'not_member' };
      }
      throw err;
    }
  }
}
