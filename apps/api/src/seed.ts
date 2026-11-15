import { eq } from 'drizzle-orm';
import { hashPassword } from './auth/password';
import { systemDb } from './db/client';
import { users } from './db/schema';

/**
 * Creates the platform admin if no account has this email; leaves an existing account untouched.
 * Uses systemDb because gym_app may never set is_platform_admin.
 */
export async function seedPlatformAdmin(rawEmail: string, password: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const [existing] = await systemDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) return;
  await systemDb
    .insert(users)
    .values({
      email,
      fullName: 'Platform admin',
      passwordHash: await hashPassword(password),
      isPlatformAdmin: true,
    })
    .onConflictDoNothing({ target: users.email });
}
