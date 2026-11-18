import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { PlatformAdmin } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AttendanceService, type NoShowRun } from './attendance.service';

const RunSchema = z.object({ gymId: z.uuid(), now: z.iso.datetime() });

/**
 * Lets the browser end-to-end tests run the no-show pass for one gym at a moment they choose,
 * instead of waiting for the class to end. Registered only when NODE_ENV is "test" (see
 * ClassesModule) and, even then, only for the platform admin.
 */
@Controller('test/classes')
export class TestClassesController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('no-shows')
  @HttpCode(200)
  @PlatformAdmin()
  noShows(
    @Body(new ZodValidationPipe(RunSchema)) body: z.infer<typeof RunSchema>,
  ): Promise<NoShowRun> {
    if (process.env.NODE_ENV !== 'test') throw new BadRequestException();
    return this.attendance.noShowPass(body.gymId, new Date(body.now));
  }
}
