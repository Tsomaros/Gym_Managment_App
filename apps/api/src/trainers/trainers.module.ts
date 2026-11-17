import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { CoversController } from './covers.controller';
import { CoversService } from './covers.service';
import { TrainersController } from './trainers.controller';
import { TrainersService } from './trainers.service';

@Module({
  imports: [MembersModule, ShiftsModule],
  controllers: [TrainersController, CoversController],
  providers: [TrainersService, CoversService],
  exports: [TrainersService, CoversService],
})
export class TrainersModule {}
