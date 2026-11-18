import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import { RemindersService } from './reminders.service';

/** Hourly at minute 5: each gym whose local time has reached 10:00 gets its reminders. */
@Injectable()
export class RemindersJob {
  private running = false;

  constructor(
    private readonly reminders: RemindersService,
    private readonly clock: Clock,
  ) {}

  @Cron('5 * * * *')
  async tick(): Promise<void> {
    // Tests call the service directly; a slow run must not overlap the next one.
    if (process.env.NODE_ENV === 'test' || this.running) return;
    this.running = true;
    try {
      const r = await this.reminders.runAll(this.clock.now());
      console.log(`[reminders] ${JSON.stringify(r)}`);
    } catch (err) {
      console.error(`[reminders] run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
