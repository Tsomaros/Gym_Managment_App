import { Body, Controller, Post, Req } from '@nestjs/common';
import { type CreateGym, CreateGymSchema } from '@gym/shared';
import type { AppRequest } from '../access/jwt.guard';
import { PlatformAdmin } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GymsService } from './gyms.service';

@Controller('platform/gyms')
export class PlatformGymsController {
  constructor(private readonly gyms: GymsService) {}

  @Post()
  @PlatformAdmin()
  async create(
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(CreateGymSchema)) body: CreateGym,
  ): Promise<{ gymId: string; mailSent: boolean }> {
    return this.gyms.create(body, req.user!.id);
  }
}
