import { sql } from 'drizzle-orm';
import { db } from './client';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in a transaction whose row-level security context is `gymId`.
 * The setting is transaction-local, so it never leaks to the next user of the pooled connection.
 */
export async function withGym<T>(gymId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.gym_id', ${gymId}, true)`);
    return fn(tx);
  });
}
