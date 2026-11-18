import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationService } from './notification.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { RemindersJob } from './reminders.job';
import { RemindersService } from './reminders.service';
import { PushService, PushTransport, WebPushTransport } from './push.service';

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [NotificationsController],
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
