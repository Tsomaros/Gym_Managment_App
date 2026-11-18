import { ClassesModule } from '../classes/classes.module';
import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { CheckInEvents } from './checkin-events';
import { CheckInService } from './checkin.service';
import { KioskCheckInController } from './kiosk.controller';
import { DEFAULT_LIVE_STREAM_MAX_MS, LIVE_STREAM_MAX_MS, LiveController } from './live.controller';
import { LiveTickets } from './live-tickets';
import { MemberCheckInController } from './member-checkin.controller';
import { OccupancyController } from './occupancy.controller';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { StaffCheckInController } from './staff-checkin.controller';

@Module({
  imports: [MembersModule, ShiftsModule, ClassesModule],
  controllers: [
    MemberCheckInController,
    KioskCheckInController,
    StaffCheckInController,
    PresenceController,
    OccupancyController,
    LiveController,
  ],
  providers: [
    CheckInService,
    CheckInEvents,
    LiveTickets,
    PresenceService,
    { provide: LIVE_STREAM_MAX_MS, useValue: DEFAULT_LIVE_STREAM_MAX_MS },
  ],
  exports: [CheckInService, CheckInEvents, PresenceService],
})
export class CheckInModule {}
