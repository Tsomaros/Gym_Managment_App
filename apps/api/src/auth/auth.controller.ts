import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { type Login, LoginSchema, type MeResponse } from '@gym/shared';
import type { Request, Response } from 'express';
import { type AppRequest, JwtGuard } from '../access/jwt.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { ThrottleLogin } from './throttle';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ThrottleLogin()
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: Login,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.auth.login(body);
    setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.auth.refresh(readRefreshCookie(req));
    setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  me(@Req() req: AppRequest): Promise<MeResponse> {
    return this.auth.me(req.user!.id);
  }
}
