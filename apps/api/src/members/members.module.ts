import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [MembershipsModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
