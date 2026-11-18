import { Module } from '@nestjs/common';
import { ClassesModule } from '../classes/classes.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { TrainersModule } from '../trainers/trainers.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [ShiftsModule, TrainersModule, ClassesModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
