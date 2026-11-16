import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import {
  type MemberDetail,
  type MembersQuery,
  MembersQuerySchema,
  type MemberSummary,
  type MyMemberships,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MembersService } from './members.service';

@Controller('gyms/:gymId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Reception and owner: every member and their state (spec §5). */
  @Get('members')
  @GymRoles('reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(MembersQuerySchema)) query: MembersQuery,
  ): Promise<MemberSummary[]> {
    return this.members.list(gym.id, query);
  }

  /** Payments history is the owner's (spec §5): reception gets the detail without it. */
  @Get('members/:memberId')
  @GymRoles('reception')
  detail(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<MemberDetail> {
    return this.members.detail(gym.id, memberId, gym.roles.includes('owner'));
  }

  /** A member's own memberships ("my membership" in the app). */
  @Get('me/memberships')
  @GymRoles('member')
  mine(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<MyMemberships> {
    return this.members.mine(gym.id, req.user!.id);
  }
}
