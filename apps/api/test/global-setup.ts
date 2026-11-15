import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { useTestDatabase } from './test-env';

/** Brings gym_test up to the latest migration once per test run. */
export default async function setup(): Promise<void> {
  const { migratorUrl } = useTestDatabase();
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: resolve(__dirname, '../src/db/migrations') });
  } finally {
    await pool.end();
  }
}
