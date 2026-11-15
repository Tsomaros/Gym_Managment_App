import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { type Login, LoginSchema, type MeResponse } from '@gym/shared';
import type { CookieOptions, Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccessTokenGuard, type AuthedRequest } from './access-token.guard';
import { AuthService } from './auth.service';
import { REFRESH_TTL_MS } from './refresh-store';

export const REFRESH_COOKIE = 'gym_rt';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/auth',
};

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: Login,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.auth.login(body);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_TTL_MS });
    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.auth.refresh(readRefreshCookie(req));
    res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_TTL_MS });
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return this.auth.me(req.user.sub);
  }
}
