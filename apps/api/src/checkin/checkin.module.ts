import { Module } from '@nestjs/common';
import { CheckInService } from './checkin.service';
import { KioskCheckInController } from './kiosk.controller';
import { MemberCheckInController } from './member-checkin.controller';
import { StaffCheckInController } from './staff-checkin.controller';

@Module({
  controllers: [MemberCheckInController, KioskCheckInController, StaffCheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}
