import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import { AttendanceService } from './attendance.service';
import { ClassNotifier } from './class-notifier';
import { TimetableService } from './timetable.service';

/** Class timetable jobs. Tests call the services directly. */
@Injectable()
export class ClassesJob {
  private running = false;
  private passing = false;
  private reminding = false;

  constructor(
    private readonly timetable: TimetableService,
    private readonly attendance: AttendanceService,
    private readonly notifier: ClassNotifier,
    private readonly clock: Clock,
  ) {}

  /** Hourly at minute 10: every gym gets its class sessions for the next 28 days. */
  @Cron('10 * * * *')
  async tick(): Promise<void> {
    // A slow run must not overlap the next one.
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

  /** Every 15 minutes: finished classes whose bookings nobody marked get their no-shows. */
  @Cron('*/15 * * * *')
  async noShows(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || this.passing) return;
    this.passing = true;
    try {
      const r = await this.attendance.noShowPassAll(this.clock.now());
      if (r.marked || r.failed) console.log(`[classes] no-shows ${JSON.stringify(r)}`);
    } catch (err) {
      console.error(`[classes] no-show pass failed: ${(err as Error).message}`);
    } finally {
      this.passing = false;
    }
  }

  /** Every 15 minutes: members whose booked class starts within 2 hours get one reminder. */
  @Cron('*/15 * * * *')
  async reminders(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || this.reminding) return;
    this.reminding = true;
    try {
      const r = await this.notifier.remindersPassAll(this.clock.now());
      if (r.sent || r.failed) console.log(`[classes] reminders ${JSON.stringify(r)}`);
    } catch (err) {
      console.error(`[classes] reminder pass failed: ${(err as Error).message}`);
    } finally {
      this.reminding = false;
    }
  }
}
