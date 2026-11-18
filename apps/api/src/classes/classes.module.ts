import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ClassNotifier } from './class-notifier';
import { ClassTypesController } from './class-types.controller';
import { ClassesJob } from './classes.job';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

@Module({
  imports: [MembersModule],
  controllers: [ClassTypesController, TimetableController, BookingsController, AttendanceController],
  providers: [TimetableService, BookingsService, AttendanceService, ClassNotifier, ClassesJob],
  exports: [TimetableService, BookingsService, AttendanceService, ClassNotifier],
})
export class ClassesModule {}
