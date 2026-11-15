import type { CookieOptions, Request, Response } from 'express';
import { getEnv } from '../config/env';
import { REFRESH_TTL_MS } from './refresh-store';

export const REFRESH_COOKIE = 'gym_rt';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: getEnv().COOKIE_PATH,
});

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge: REFRESH_TTL_MS });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
}
