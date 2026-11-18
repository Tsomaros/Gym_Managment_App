import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { PushService, PushTransport, WebPushTransport } from './push.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    NotificationSettingsService,
    PushService,
    { provide: PushTransport, useClass: WebPushTransport },
  ],
  exports: [NotificationService, PushTransport],
})
export class NotificationsModule {}
