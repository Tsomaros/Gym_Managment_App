/**
 * The platform admin's access token for specs that set a gym up through the API. It is signed in
 * once per run by e2e/global-setup.ts: the login route allows 5 attempts a minute and the specs
 * run in parallel workers, so one sign-in per spec would trip the limit.
 */
export async function adminLogin(): Promise<{ accessToken: string }> {
  const accessToken = process.env.E2E_ADMIN_TOKEN;
  if (!accessToken) throw new Error('E2E_ADMIN_TOKEN is not set (see e2e/global-setup.ts)');
  return { accessToken };
}
