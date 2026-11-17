import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type AuditPage, type AuditQuery, AuditQuerySchema } from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('gyms/:gymId/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Owner only (spec §5): the gym's change history, newest first. */
  @Get()
  @GymRoles('owner')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.audit.list(gym.id, query);
  }
}
