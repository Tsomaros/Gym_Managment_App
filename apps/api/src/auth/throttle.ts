import { applyDecorators, UseGuards } from '@nestjs/common';
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
];

/** POST /auth/login: 5 attempts per 60 s per IP and email, then 429. */
export const ThrottleLogin = () =>
  applyDecorators(UseGuards(ThrottlerGuard), SkipThrottle({ signup: true }));

/** Public sign-up and email confirmation: 10 per 60 s per IP, then 429. */
export const ThrottleSignup = () =>
  applyDecorators(UseGuards(ThrottlerGuard), SkipThrottle({ login: true }));
