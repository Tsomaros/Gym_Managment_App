import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ClassTypesController } from './class-types.controller';
import { ClassesJob } from './classes.job';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

@Module({
  imports: [MembersModule],
  controllers: [ClassTypesController, TimetableController, BookingsController],
  providers: [TimetableService, BookingsService, ClassesJob],
  exports: [TimetableService, BookingsService],
})
export class ClassesModule {}
