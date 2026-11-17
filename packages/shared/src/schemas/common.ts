import { z } from 'zod';
import { GYM_ROLES } from '../roles.js';

export const LOCALES = ['el', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Every email is stored and compared as trim().toLowerCase(). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** One or more gym roles, duplicates removed. */
export const gymRolesSchema = z
  .array(z.enum(GYM_ROLES))
  .min(1)
  .transform((roles) => [...new Set(roles)]);

/**
 * An IANA timezone name, e.g. 'Europe/Athens', 'Asia/Kolkata' or 'UTC'. Intl also accepts fixed
 * offsets ('+02:00', no DST) and any casing ('europe/athens'); both are rejected. Aliases stay valid:
 * V8 resolves Asia/Kolkata to Asia/Calcutta, so a different name back is fine, a different casing is not.
 */
export const timezoneSchema = z.string().refine(
  (tz) => {
    if (!/^[A-Za-z]/.test(tz)) return false;
    try {
      const resolved = new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;
      return resolved === tz || resolved.toLowerCase() !== tz.toLowerCase();
    } catch {
      return false;
    }
  },
  { message: 'Unknown IANA timezone' },
);

/** A first or last name: trimmed, 1 to 60 characters. */
export const personNameSchema = z.string().trim().min(1).max(60);

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * A phone number normalised to E.164. Spaces, dashes and brackets are dropped, a leading 00
 * becomes +, and a 10-digit Greek number (mobile 69…, landline 2…) gets +30.
 */
export const phoneSchema = z
  .string()
  .transform((raw) => {
    let p = raw.replace(/[\s\-()]/g, '');
    if (p.startsWith('00')) p = `+${p.slice(2)}`;
    if (/^(69|2)\d+$/.test(p) && p.length === 10) p = `+30${p}`;
    return p;
  })
  .refine((p) => E164.test(p), { message: 'Invalid phone number' });

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `s` is YYYY-MM-DD and names a real calendar day. */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** A calendar date as YYYY-MM-DD. */
export const isoDateSchema = z.string().refine(isIsoDate, { message: 'Invalid date' });

const MAX_AGE_YEARS = 110;

/**
 * Date of birth (YYYY-MM-DD): not after `today`, not more than 110 years before it.
 * Without `today`, the current UTC date is used at the time of each parse.
 */
export function makeDateOfBirthSchema(today?: string) {
  return isoDateSchema.refine(
    (dob) => {
      const now = today ?? new Date().toISOString().slice(0, 10);
      const oldest = `${String(Number(now.slice(0, 4)) - MAX_AGE_YEARS).padStart(4, '0')}${now.slice(4)}`;
      // ISO dates compare correctly as strings.
      return dob <= now && dob >= oldest;
    },
    { message: 'Date of birth out of range' },
  );
}

export const dateOfBirthSchema = makeDateOfBirthSchema();
