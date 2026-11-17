import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { type StaffList, type StaffRole, StaffRoleSchema } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StaffService } from './staff.service';

@Controller('gyms/:gymId/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @GymRoles('reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<StaffList> {
    return this.staff.list(gym.id, gym.roles.includes('owner'));
  }

  @Delete(':userId/roles/:role')
  @HttpCode(204)
  @GymRoles('owner')
  removeRole(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('role', new ZodValidationPipe(StaffRoleSchema)) role: StaffRole,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.staff.removeRole(gym.id, req.user!.id, userId, role);
  }
}
