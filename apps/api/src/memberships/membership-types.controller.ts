import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type MembershipType,
  type MembershipTypeInput,
  MembershipTypeInputSchema,
  MembershipTypeListQuerySchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MembershipTypesService } from './membership-types.service';

/** Owner sets types and prices (spec §5); reception reads them to sell. No delete: archive. */
@Controller('gyms/:gymId/membership-types')
export class MembershipTypesController {
  constructor(private readonly types: MembershipTypesService) {}

  @Get()
  @GymRoles('reception')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Query(new ZodValidationPipe(MembershipTypeListQuerySchema))
    query: { includeArchived: boolean },
  ): Promise<MembershipType[]> {
    return this.types.list(gym.id, query.includeArchived);
  }

  @Post()
  @GymRoles('owner')
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(MembershipTypeInputSchema)) body: MembershipTypeInput,
  ): Promise<MembershipType> {
    return this.types.create(gym.id, req.user!.id, body);
  }

  @Patch(':id')
  @GymRoles('owner')
  update(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(MembershipTypeInputSchema)) body: MembershipTypeInput,
  ): Promise<MembershipType> {
    return this.types.update(gym.id, req.user!.id, id, body);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @GymRoles('owner')
  archive(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.types.archive(gym.id, req.user!.id, id);
  }
}
