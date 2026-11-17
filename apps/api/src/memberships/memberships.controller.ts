import { Body, Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { type Membership, type SellMembership, SellMembershipSchema } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MembershipsService } from './memberships.service';

@Controller('gyms/:gymId/members/:memberId/memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  /** Reception sells or renews a membership and records the payment (spec §6.1). */
  @Post()
  @GymRoles('reception')
  sell(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(SellMembershipSchema)) body: SellMembership,
  ): Promise<Membership> {
    return this.memberships.sell(gym.id, req.user!.id, memberId, body);
  }
}
