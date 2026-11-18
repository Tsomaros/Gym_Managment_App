import { Module } from '@nestjs/common';
import { ClassTypesController } from './class-types.controller';
import { ClassesJob } from './classes.job';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

@Module({
  controllers: [ClassTypesController, TimetableController],
  providers: [TimetableService, ClassesJob],
  exports: [TimetableService],
})
export class ClassesModule {}
