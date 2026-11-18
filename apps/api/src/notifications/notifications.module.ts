import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationService } from './notification.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { TestRemindersController } from './test-reminders.controller';
import { RemindersJob } from './reminders.job';
import { RemindersService } from './reminders.service';
import { PushService, PushTransport, WebPushTransport } from './push.service';

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  // The e2e-only endpoint exists only in a test run (NODE_ENV=test).
  controllers: [
    NotificationsController,
    ...(process.env.NODE_ENV === 'test' ? [TestRemindersController] : []),
  ],
  providers: [
    NotificationService,
    NotificationSettingsService,
    RemindersService,
    RemindersJob,
    PushService,
    { provide: PushTransport, useClass: WebPushTransport },
  ],
  exports: [NotificationService, PushTransport, RemindersService],
})
export class NotificationsModule {}
