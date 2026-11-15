import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

export interface AccessClaims {
  sub: string;
  adm: boolean;
}

const ACCESS_TTL_SECONDS = 15 * 60;

export function signAccessToken(p: AccessClaims): string {
  return jwt.sign({ adm: p.adm }, getEnv().JWT_SECRET, {
    algorithm: 'HS256',
    subject: p.sub,
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

/** Throws on a bad signature, wrong algorithm, expiry or missing claims. */
export function verifyAccessToken(t: string): AccessClaims {
  const payload = jwt.verify(t, getEnv().JWT_SECRET, { algorithms: ['HS256'] });
  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.adm !== 'boolean'
  ) {
    throw new Error('Malformed access token');
  }
  return { sub: payload.sub, adm: payload.adm };
}
