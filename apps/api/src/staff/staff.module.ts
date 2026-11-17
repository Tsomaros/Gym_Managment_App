import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module';
import { TrainersModule } from '../trainers/trainers.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [ShiftsModule, TrainersModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
