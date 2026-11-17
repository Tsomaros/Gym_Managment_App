/**
 * Signs the platform admin in once for the whole run. The specs run in parallel workers and most of
 * them set a gym up through the API as the admin; the login route allows 5 attempts a minute, so
 * one sign-in per spec trips the limit as soon as there are more than a handful of specs.
 * Workers inherit the token through the environment (see e2e/admin.ts).
 */
export default async function globalSetup(): Promise<void> {
  const res = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.PLATFORM_ADMIN_EMAIL,
      password: process.env.PLATFORM_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`admin sign-in failed: ${res.status} ${await res.text()}`);
  process.env.E2E_ADMIN_TOKEN = ((await res.json()) as { accessToken: string }).accessToken;
}
