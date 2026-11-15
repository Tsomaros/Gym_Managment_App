import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_MIGRATOR_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url(),
  SMTP_URL: z.url(),
  PLATFORM_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8),
  /** Path of the refresh cookie as the browser sees it: /api/auth when a proxy serves the API under /api. */
  COOKIE_PATH: z.string().startsWith('/').default('/auth'),
});

export type Env = z.infer<typeof envSchema>;

/** Validates the environment. Throws, naming every bad or missing key, if it is incomplete. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** loadEnv() from process.env, validated once and reused. */
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
