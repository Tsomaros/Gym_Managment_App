import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import { TimetableService } from './timetable.service';

/** Hourly at minute 10: every gym gets its class sessions for the next 28 days. */
@Injectable()
export class ClassesJob {
  private running = false;

  constructor(
    private readonly timetable: TimetableService,
    private readonly clock: Clock,
  ) {}

  @Cron('10 * * * *')
  async tick(): Promise<void> {
    // Tests call the service directly; a slow run must not overlap the next one.
    if (process.env.NODE_ENV === 'test' || this.running) return;
    this.running = true;
    try {
      const r = await this.timetable.materialiseAll(this.clock.now());
      console.log(`[classes] ${JSON.stringify(r)}`);
    } catch (err) {
      console.error(`[classes] run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
