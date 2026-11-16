import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Points the API at the gym_test database. Loads the repo's .env when present (local runs);
 * CI sets the variables directly. Whatever database the URLs name, tests always use gym_test.
 */
export function useTestDatabase(): { appUrl: string; systemUrl: string; migratorUrl: string } {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const toTestDb = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} must be set (copy .env.example to .env)`);
    const url = new URL(value);
    url.pathname = '/gym_test';
    process.env[key] = url.toString();
    return url.toString();
  };

  return {
    appUrl: toTestDb('DATABASE_URL'),
    systemUrl: toTestDb('DATABASE_SYSTEM_URL'),
    migratorUrl: toTestDb('DATABASE_MIGRATOR_URL'),
  };
}
