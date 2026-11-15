import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { GymsService } from './gyms.service';
import { PlatformGymsController } from './platform-gyms.controller';

@Module({
  imports: [InvitationsModule],
  controllers: [PlatformGymsController],
  providers: [GymsService],
})
export class GymsModule {}
