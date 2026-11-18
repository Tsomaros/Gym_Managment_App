import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  type ClassTypeView,
  type CreateClassType,
  CreateClassTypeSchema,
  type UpdateClassType,
  UpdateClassTypeSchema,
} from '@gym/shared';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TimetableService } from './timetable.service';

@Controller('gyms/:gymId/class-types')
export class ClassTypesController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  @GymRoles('reception', 'trainer')
  list(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
  ): Promise<ClassTypeView[]> {
    return this.timetable.listTypes(gym.id);
  }

  @Post()
  @GymRoles('owner')
  create(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateClassTypeSchema)) body: CreateClassType,
  ): Promise<ClassTypeView> {
    return this.timetable.createType(gym.id, req.user!.id, body);
  }

  @Patch(':id')
  @GymRoles('owner')
  update(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(UpdateClassTypeSchema)) body: UpdateClassType,
  ): Promise<ClassTypeView> {
    return this.timetable.updateType(gym.id, req.user!.id, id, body);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @GymRoles('owner')
  async archive(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.timetable.archiveType(gym.id, req.user!.id, id);
  }
}
