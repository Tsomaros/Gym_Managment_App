import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { GymSettingsController } from './gym-settings.controller';
import { GymSettingsService } from './gym-settings.service';
import { GymsService } from './gyms.service';
import { PlatformGymsController } from './platform-gyms.controller';

@Module({
  imports: [InvitationsModule],
  controllers: [PlatformGymsController, GymSettingsController],
  providers: [GymsService, GymSettingsService],
})
export class GymsModule {}
