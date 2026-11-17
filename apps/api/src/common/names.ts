import { inArray } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { users } from '../db/schema';

/**
 * Full names by user id, for people referenced by a gym's own rows (who sold, who voided, who
 * acted). They may no longer hold a role in the gym, which hides them from gym_app under users
 * RLS, so names are read through systemDb, and only for ids the caller already got from the gym.
 */
export async function namesOf(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const rows = await systemDb
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

/** `{ id, fullName }` for a referenced person, or null when there is none or it was erased. */
export function person(
  id: string | null,
  names: Map<string, string>,
): { id: string; fullName: string } | null {
  const fullName = id ? names.get(id) : undefined;
  return id && fullName !== undefined ? { id, fullName } : null;
}
