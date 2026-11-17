import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type Signup,
  type SignupCodeResponse,
  type SignupResponse,
  SignupSchema,
  type VerifyEmail,
  VerifyEmailSchema,
} from '@gym/shared';
import type { Response } from 'express';
import { CurrentGym, type GymContext } from '../access/gym-context';
import { type AppRequest, JwtGuard } from '../access/jwt.guard';
import { GymRoles } from '../access/roles.decorator';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { RefreshStore } from '../auth/refresh-store';
import { ThrottleSignup } from '../auth/throttle';
import { signAccessToken } from '../auth/tokens';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SignupService } from './signup.service';

@Controller()
export class SignupController {
  constructor(
    private readonly signups: SignupService,
    private readonly refreshStore: RefreshStore,
  ) {}

  /** Reception presses "New member code" (spec §6.0). */
  @Post('gyms/:gymId/signup-codes')
  @GymRoles('reception')
  issueCode(
    @Param('gymId', ParseUUIDPipe) _gymId: string,
    @CurrentGym() gym: GymContext,
    @Req() req: AppRequest,
  ): Promise<SignupCodeResponse> {
    return this.signups.issueCode(gym.id, req.user!.id);
  }

  /** Public: the code from reception is the credential. A new account is signed in at once. */
  @Post('auth/signup')
  @ThrottleSignup()
  async signup(
    @Body(new ZodValidationPipe(SignupSchema)) body: Signup,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignupResponse> {
    // A new account, or an existing one that proved its password: either way, signed in.
    const { userId, isPlatformAdmin } = await this.signups.signup(body);
    setRefreshCookie(res, await this.refreshStore.issue(userId));
    return { accessToken: signAccessToken({ sub: userId, adm: isPlatformAdmin }) };
  }

  /** Public: the emailed token is the credential. */
  @Post('auth/verify-email')
  @HttpCode(204)
  @ThrottleSignup()
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: VerifyEmail,
  ): Promise<void> {
    await this.signups.verifyEmail(body.token);
  }

  /** Each call sends an email, so it shares the sign-up limit (10 per 60 s per IP). */
  @Post('auth/resend-verification')
  @HttpCode(204)
  @UseGuards(JwtGuard)
  @ThrottleSignup()
  async resend(@Req() req: AppRequest): Promise<void> {
    await this.signups.resendVerification(req.user!.id);
  }
}
