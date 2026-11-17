import {
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
  type PresentMember,
  type VisitorRow,
  type VisitorsQuery,
  VisitorsQuerySchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PresenceService } from './presence.service';

/** Who is in the gym and who came today (spec §6.2). */
@Controller('gyms/:gymId/check-ins')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('present')
  @GymRoles('trainer', 'reception')
  present(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<PresentMember[]> {
    return this.presence.present(gym.id);
  }

  @Get()
  @GymRoles('reception')
  visitors(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(VisitorsQuerySchema)) q: VisitorsQuery,
  ): Promise<VisitorRow[]> {
    return this.presence.visitors(gym.id, q.date);
  }

  @Post(':id/check-out')
  @HttpCode(204)
  @GymRoles('reception')
  checkOut(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.presence.checkOut(gym.id, req.user!.id, id);
  }
}
