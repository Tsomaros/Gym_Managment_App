import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url: the raw value handed to the client (cookie or emailed link). */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Only this hash is stored, so a database leak doesn't hand out usable tokens. */
export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');
