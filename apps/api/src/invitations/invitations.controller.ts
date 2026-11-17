import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AcceptInvite,
  type AcceptInviteResponse,
  AcceptInviteSchema,
  type Invite,
  type InvitePreview,
  InviteSchema,
} from '@gym/shared';
import type { Response } from 'express';
import { CurrentGym, type GymContext } from '../access/gym-context';
import type { AppRequest } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { RefreshStore } from '../auth/refresh-store';
import { signAccessToken } from '../auth/tokens';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InvitationsService } from './invitations.service';

@Controller()
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly refreshStore: RefreshStore,
  ) {}

  /** Owner may invite any roles; reception only members. */
  @Post('gyms/:gymId/invitations')
  @GymRoles('reception')
  async invite(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
    @Body(new ZodValidationPipe(InviteSchema)) body: Invite,
  ): Promise<{ invitationId: string; mailSent: boolean }> {
    return this.invitations.invite(gym, req.user!.id, body);
  }

  /** Owner only: withdraws a pending invitation; its link then gives 410. */
  @Post('gyms/:gymId/invitations/:id/cancel')
  @HttpCode(204)
  @GymRoles('owner')
  cancel(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.invitations.cancel(gym.id, req.user!.id, id);
  }

  /** Public: what the invite page shows before the person accepts. 410 if not redeemable. */
  @Get('auth/invitations/:token')
  preview(@Param('token') token: string): Promise<InvitePreview> {
    return this.invitations.preview(token);
  }

  /**
   * Public: the emailed token is the credential. A new account is signed in at once; an existing
   * account only gains the roles and must sign in with its own password.
   */
  @Post('auth/accept-invite')
  @HttpCode(200)
  async accept(
    @Body(new ZodValidationPipe(AcceptInviteSchema)) body: AcceptInvite,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptInviteResponse> {
    const { userId, isPlatformAdmin, created } = await this.invitations.accept(body);
    if (!created) return { signInRequired: true };
    setRefreshCookie(res, await this.refreshStore.issue(userId));
    return { accessToken: signAccessToken({ sub: userId, adm: isPlatformAdmin }) };
  }
}
