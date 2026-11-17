import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CheckInModule } from './checkin/checkin.module';
import { ClockModule } from './common/clock';
import { THROTTLERS } from './auth/throttle';
import { closeDb } from './db/client';
import { DevicesModule } from './devices/devices.module';
import { GymsModule } from './gyms/gyms.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { MembersModule } from './members/members.module';
import { MembershipsModule } from './memberships/memberships.module';
import { SignupModule } from './signup/signup.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: THROTTLERS }),
    ClockModule,
    MailModule,
    AuditModule,
    AuthModule,
    InvitationsModule,
    GymsModule,
    SignupModule,
    MembershipsModule,
    MembersModule,
    CheckInModule,
    DevicesModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDb();
  }
}
