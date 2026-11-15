import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

type UrlKey = 'DATABASE_URL' | 'DATABASE_MIGRATOR_URL';

function makePool(key: UrlKey, max?: number): Pool {
  const connectionString = process.env[key];
  if (!connectionString) throw new Error(`${key} is not set`);
  const pool = new Pool({ connectionString, max });
  // Without a listener, an idle client dropping (Postgres restart, network blip) crashes the process.
  pool.on('error', (err) => console.error(`[db] idle client error (${key}): ${err.message}`));
  return pool;
}

/** Runtime connection as gym_app: row-level security applies. Gym-scoped work goes through withGym. */
export const db = drizzle({ client: makePool('DATABASE_URL'), schema });

/**
 * Owner connection (gym_owner, BYPASSRLS). Only for paths where no gym is known yet:
 * platform-admin gym creation and token lookups.
 */
export const systemDb = drizzle({ client: makePool('DATABASE_MIGRATOR_URL', 5), schema });

export type Db = typeof db;

let closing: Promise<void> | undefined;

/** Ends both pools. Safe to call more than once (Nest shutdown and test teardown both call it). */
export function closeDb(): Promise<void> {
  closing ??= Promise.all([db.$client.end(), systemDb.$client.end()]).then(() => undefined);
  return closing;
}
