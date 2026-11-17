import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { CheckInEvents } from './checkin-events';
import { CheckInService } from './checkin.service';
import { KioskCheckInController } from './kiosk.controller';
import { LiveController } from './live.controller';
import { LiveTickets } from './live-tickets';
import { MemberCheckInController } from './member-checkin.controller';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { StaffCheckInController } from './staff-checkin.controller';

@Module({
  imports: [MembersModule],
  controllers: [
    MemberCheckInController,
    KioskCheckInController,
    StaffCheckInController,
    PresenceController,
    LiveController,
  ],
  providers: [CheckInService, CheckInEvents, LiveTickets, PresenceService],
  exports: [CheckInService, CheckInEvents],
})
export class CheckInModule {}
