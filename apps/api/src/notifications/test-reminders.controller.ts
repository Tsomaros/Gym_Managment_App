import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { PlatformAdmin } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type ReminderRun, RemindersService } from './reminders.service';

const RunSchema = z.object({ gymId: z.uuid(), now: z.iso.datetime() });

/**
 * Lets the browser end-to-end tests run the reminders for one gym at a moment they choose,
 * instead of waiting for the hourly job. Registered only when NODE_ENV is "test" (see
 * NotificationsModule) and, even then, only for the platform admin.
 */
@Controller('test/reminders')
export class TestRemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run')
  @HttpCode(200)
  @PlatformAdmin()
  run(
    @Body(new ZodValidationPipe(RunSchema)) body: z.infer<typeof RunSchema>,
  ): Promise<ReminderRun> {
    if (process.env.NODE_ENV !== 'test') throw new BadRequestException();
    return this.reminders.runForGym(body.gymId, new Date(body.now));
  }
}
