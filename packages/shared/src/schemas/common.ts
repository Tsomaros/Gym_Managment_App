import { z } from 'zod';
import { GYM_ROLES } from '../roles.js';

export const LOCALES = ['el', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Every email is stored and compared as trim().toLowerCase(). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const fullNameSchema = z.string().trim().min(1).max(120);

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
