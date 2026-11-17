import { applyDecorators, UseGuards } from '@nestjs/common';
import { DeviceGuard } from '../devices/device.guard';
import { SkipThrottle, ThrottlerGuard, type ThrottlerOptions } from '@nestjs/throttler';

// shortcut: in-memory throttle store, move to Redis when running more than one API instance.

const MINUTE_MS = 60_000;

/** Lowercased, trimmed email from the body: guards run before the validation pipe normalises it. */
function bodyEmail(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
}

/**
 * Named throttlers. Every throttled route uses ThrottlerGuard and skips the throttlers that are
 * not its own. Counters are per route (the default key includes the controller and handler).
 */
export const THROTTLERS: ThrottlerOptions[] = [
  {
    name: 'login',
    limit: 5,
    ttl: MINUTE_MS,
    getTracker: (req) => `${String(req.ip)}|${bodyEmail(req)}`,
  },
  {
    name: 'signup',
    limit: 10,
    ttl: MINUTE_MS,
    getTracker: (req) => String(req.ip),
  },
  {
    name: 'pair',
    limit: 10,
    ttl: MINUTE_MS,
    getTracker: (req) => String(req.ip),
  },
  {
    name: 'kiosk',
    limit: 60,
    ttl: MINUTE_MS,
    // ThrottleKiosk() puts DeviceGuard first, which sets req.device.
    getTracker: (req) => (req as { device?: { id: string } }).device?.id ?? String(req.ip),
  },
];

const ALL = THROTTLERS.map((t) => t.name!);

/** Applies ThrottlerGuard with only the named throttler active. */
const only = (name: string) =>
  applyDecorators(
    UseGuards(ThrottlerGuard),
    SkipThrottle(Object.fromEntries(ALL.filter((n) => n !== name).map((n) => [n, true]))),
  );

/** POST /auth/login: 5 attempts per 60 s per IP and email, then 429. */
export const ThrottleLogin = () => only('login');

/** Public sign-up and email confirmation: 10 per 60 s per IP, then 429. */
export const ThrottleSignup = () => only('signup');

/** POST /kiosk/pair: 10 per 60 s per IP, then 429. */
export const ThrottlePair = () => only('pair');

/** Kiosk routes: DeviceGuard, then 60 per 60 s per device (the order matters: the tracker is the device). */
export const ThrottleKiosk = () => applyDecorators(UseGuards(DeviceGuard), only('kiosk'));
