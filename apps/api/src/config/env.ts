import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_MIGRATOR_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url(),
  SMTP_URL: z.url(),
  PLATFORM_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8),
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
