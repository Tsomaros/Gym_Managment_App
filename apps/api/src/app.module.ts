import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { THROTTLERS } from './auth/throttle';
import { closeDb } from './db/client';
import { GymsModule } from './gyms/gyms.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: THROTTLERS }),
    MailModule,
    AuthModule,
    InvitationsModule,
    GymsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDb();
  }
}
