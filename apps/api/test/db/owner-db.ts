import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * Test-only connection as gym_owner (DATABASE_MIGRATOR_URL, rewritten to gym_test by test-env).
 * For the few tests that need DDL, which systemDb (gym_system) is not allowed to run.
 */
export function ownerDb() {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is not set');
  return drizzle({ client: new Pool({ connectionString: url, max: 1 }) });
}
