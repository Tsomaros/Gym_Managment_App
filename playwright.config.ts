import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The e2e run uses the gym_test database, never the dev database.
if (existsSync('.env')) process.loadEnvFile('.env');
const toTestDb = (value: string | undefined): string => {
  if (!value)
    throw new Error(
      'DATABASE_URL, DATABASE_SYSTEM_URL and DATABASE_MIGRATOR_URL must be set (see .env keys in PROGRESS.md)',
    );
  const url = new URL(value);
  url.pathname = '/gym_test';
  return url.toString();
};
const apiEnv = {
  DATABASE_URL: toTestDb(process.env.DATABASE_URL),
  DATABASE_SYSTEM_URL: toTestDb(process.env.DATABASE_SYSTEM_URL),
  DATABASE_MIGRATOR_URL: toTestDb(process.env.DATABASE_MIGRATOR_URL),
  WEB_ORIGIN: 'http://localhost:5173',
  PORT: '3000',
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter api db:migrate && pnpm --filter api build && pnpm --filter api start',
      url: 'http://localhost:3000/health',
      env: apiEnv,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter web dev',
      url: 'http://localhost:5173',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
