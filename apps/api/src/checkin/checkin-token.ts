import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env';

const PREFIX = 'GYM1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A token is accepted this long after it was issued; the member app refreshes it every 30 s. */
export const CHECKIN_TOKEN_TTL_SECONDS = 45;

const sign = (data: string, secret: string): Buffer =>
  createHmac('sha256', secret).update(data).digest();

/** `GYM1.<payload>.<sig>`: payload is base64url JSON {m: memberId, g: gymId, x: expiry (unix s)}. */
export function signCheckInToken(
  p: { memberId: string; gymId: string },
  now: Date,
  secret: string = getEnv().CHECKIN_SECRET,
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + CHECKIN_TOKEN_TTL_SECONDS * 1000);
  const payload = Buffer.from(
    JSON.stringify({ m: p.memberId, g: p.gymId, x: Math.floor(expiresAt.getTime() / 1000) }),
  ).toString('base64url');
  const head = `${PREFIX}.${payload}`;
  return { token: `${head}.${sign(head, secret).toString('base64url')}`, expiresAt };
}

/** The member and gym a token names, or null for anything wrong with it. Never throws. */
export function verifyCheckInToken(
  token: string,
  now: Date,
  secret: string = getEnv().CHECKIN_SECRET,
): { memberId: string; gymId: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) return null;
    const [, payload, sig] = parts as [string, string, string];

    const expected = sign(`${PREFIX}.${payload}`, secret);
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data !== 'object' || data === null) return null;
    const { m, g, x } = data as Record<string, unknown>;
    if (typeof m !== 'string' || typeof g !== 'string' || typeof x !== 'number') return null;
    // Ids go straight into queries later: a non-UUID must be a clean rejection, not a 500.
    if (!UUID_RE.test(m) || !UUID_RE.test(g)) return null;
    if (now.getTime() >= x * 1000) return null;
    return { memberId: m, gymId: g };
  } catch {
    return null;
  }
}
