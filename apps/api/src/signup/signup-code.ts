import { randomInt } from 'node:crypto';
import { hashToken } from '../auth/opaque-token';

/** No 0/O, 1/I/L: easy to read aloud and type from a phone screen. */
export const SIGNUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;
const VALID = new RegExp(`^[${SIGNUP_CODE_ALPHABET}]{${LENGTH}}$`);

export const SIGNUP_CODE_TTL_MS = 24 * 3600 * 1000;

/** A fresh code: `raw` (8 chars), `display` (XXXX-XXXX) and the sha256 `hash` that is stored. */
export function generateSignupCode(): { raw: string; display: string; hash: string } {
  let raw = '';
  for (let i = 0; i < LENGTH; i++)
    raw += SIGNUP_CODE_ALPHABET[randomInt(SIGNUP_CODE_ALPHABET.length)];
  return { raw, display: `${raw.slice(0, 4)}-${raw.slice(4)}`, hash: hashToken(raw) };
}

/** Upper-cases and drops dashes and spaces; null unless 8 characters from the alphabet remain. */
export function normaliseSignupCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return VALID.test(code) ? code : null;
}
