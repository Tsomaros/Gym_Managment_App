import { type SQL, sql } from 'drizzle-orm';

/** Lower case, no accents, final sigma as σ: how names, emails and phones are compared. */
export const normalised = (value: SQL) => sql`translate(unaccent(lower(${value})), 'ς', 'σ')`;
/** `%` and `_` typed by the user match themselves, not "anything". */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
