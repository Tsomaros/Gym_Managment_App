import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Migrations run as gym_owner (DATABASE_MIGRATOR_URL), never as the runtime role gym_app.
// RLS policies and grants live in hand-written migrations (drizzle-kit generate --custom);
// drizzle-kit doesn't track them, so every new gym-owned table needs its own custom migration.
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) throw new Error('DATABASE_MIGRATOR_URL is not set (copy .env.example to .env)');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url },
  strict: true,
});
