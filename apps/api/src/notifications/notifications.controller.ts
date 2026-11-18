import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type NotificationPrefs,
  NotificationPrefsSchema,
  type PushSubscriptionInput,
  PushSubscriptionSchema,
  RemovePushSubscriptionSchema,
} from '@gym/shared';
import { type AppRequest, JwtGuard } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { getEnv } from '../config/env';
import { NotificationSettingsService } from './notification-settings.service';

@Controller()
export class NotificationsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get('push/vapid-public-key')
  vapidKey(): { key: string } {
    return { key: getEnv().VAPID_PUBLIC_KEY };
  }

  @Put('me/push-subscriptions')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  async subscribe(
    @Req() req: AppRequest,
    @Headers('user-agent') userAgent: string | undefined,
    @Body(new ZodValidationPipe(PushSubscriptionSchema)) body: PushSubscriptionInput,
  ): Promise<void> {
    await this.settings.subscribe(req.user!.id, body, userAgent);
  }

  @Delete('me/push-subscriptions')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  async unsubscribe(
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(RemovePushSubscriptionSchema)) body: { endpoint: string },
  ): Promise<void> {
    await this.settings.unsubscribe(req.user!.id, body.endpoint);
  }

  @Get('gyms/:gymId/me/notification-prefs')
  @GymRoles('member')
  getPrefs(
    @Param('gymId', ParseUUIDPipe) gymId: string,
    @Req() req: AppRequest,
  ): Promise<NotificationPrefs> {
    return this.settings.getPrefs(gymId, req.user!.id);
  }

  @Put('gyms/:gymId/me/notification-prefs')
  @GymRoles('member')
  setPrefs(
    @Param('gymId', ParseUUIDPipe) gymId: string,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(NotificationPrefsSchema)) body: NotificationPrefs,
  ): Promise<NotificationPrefs> {
    return this.settings.setPrefs(gymId, req.user!.id, body);
  }
}
