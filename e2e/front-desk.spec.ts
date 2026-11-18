import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { adminLogin } from './admin';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const API = 'http://localhost:3000';

async function inviteToken(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const m of messages) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string;
      };
      const match = msg.Text.match(/\/invite\/([A-Za-z0-9_-]+)/);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no invite email for ${to}`);
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  auth?: string,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(auth ? { authorization: auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text(); // a 204 (revoke) has no body
  return (text ? JSON.parse(text) : undefined) as T;
}
const post = <T>(path: string, body: unknown, bearer?: string) =>
  call<T>('POST', path, body, bearer ? `Bearer ${bearer}` : undefined);

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Κωδικός').fill(password);
  await page.getByRole('button', { name: 'Σύνδεση' }).click();
}

test('a member shows their code to a paired tablet, reception sees it live and checks them out', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-fd-${run}@example.com`;
  const receptionEmail = `rec-fd-${run}@example.com`;
  const memberEmail = `member-fd-${run}@example.com`;
  const password = 'a long password 1';

  // Set-up through the API: gym, owner, receptionist, a member with a one-month membership.
  const admin = await adminLogin();
  const { gymId } = await post<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο Είσοδος ${run}`,
      ownerEmail,
      ownerFirstName: 'Άννα',
      ownerLastName: 'Ιδιοκτήτρια',
    },
    admin.accessToken,
  );
  const owner = await post<{ accessToken: string }>('/auth/accept-invite', {
    token: await inviteToken(ownerEmail),
    password,
  });
  await post(
    `/gyms/${gymId}/invitations`,
    { email: receptionEmail, firstName: 'Μαρία', lastName: 'Υποδοχή', roles: ['reception'] },
    owner.accessToken,
  );
  const reception = await post<{ accessToken: string }>('/auth/accept-invite', {
    token: await inviteToken(receptionEmail),
    password,
  });
  const { code: signupCode } = await post<{ code: string }>(
    `/gyms/${gymId}/signup-codes`,
    {},
    reception.accessToken,
  );
  await post('/auth/signup', {
    code: signupCode,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    email: memberEmail,
    phone: '6912345678',
    dateOfBirth: '1990-05-17',
    password,
    acceptPrivacy: true,
  });
  const type = await post<{ id: string }>(
    `/gyms/${gymId}/membership-types`,
    {
      name: 'Μηνιαία',
      kind: 'time',
      durationMonths: 1,
      priceCents: 4000,
      maxFreezeDays: 0,
    },
    owner.accessToken,
  );
  const members = await call<{ userId: string; email: string }[]>(
    'GET',
    `/gyms/${gymId}/members`,
    undefined,
    `Bearer ${reception.accessToken}`,
  );
  const memberId = members.find((m) => m.email === memberEmail)!.userId;
  await post(
    `/gyms/${gymId}/members/${memberId}/memberships`,
    { typeId: type.id, amountCents: 4000, method: 'cash' },
    reception.accessToken,
  );

  // Context A: the entrance tablet, paired with a code the owner made.
  const { code: pairingCode } = await post<{ code: string }>(
    `/gyms/${gymId}/devices/pairing-codes`,
    { name: 'Είσοδος' },
    owner.accessToken,
  );
  const tabletContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await tabletContext.newPage();
  await tablet.goto('/kiosk');
  await tablet.getByLabel('Κωδικός σύνδεσης').fill(pairingCode);
  await tablet.getByRole('button', { name: 'Σύνδεση' }).click();
  await expect(tablet.getByRole('heading', { name: 'Σκάναρε τον κωδικό σου' })).toBeVisible();
  const deviceToken = await tablet.evaluate(() => localStorage.getItem('gym.kiosk.device'));
  expect(deviceToken).toBeTruthy();

  // Context B: the member on their phone opens the check-in screen.
  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await phoneContext.newPage();
  await signIn(phone, memberEmail, password);
  await expect(
    phone.getByRole('img', { name: /Κωδικός εισόδου για Γιώργος Παπαδόπουλος/ }),
  ).toBeVisible();

  // Context C: reception's desk, with the live link up.
  const deskContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await deskContext.newPage();
  await signIn(desk, receptionEmail, password);
  await expect(desk.getByRole('status', { name: 'Κατάσταση σύνδεσης' })).toContainText('Ζωντανά');
  await expect(desk.getByText('Δεν υπάρχει κανείς μέσα.')).toBeVisible();

  // The camera cannot be driven in CI: read the code the way the phone does and hand it to the
  // kiosk endpoint with the device token, as the scanner would.
  const memberLogin = await post<{ accessToken: string }>('/auth/login', {
    email: memberEmail,
    password,
  });
  const { token } = await call<{ token: string }>(
    'GET',
    `/gyms/${gymId}/me/check-in-token`,
    undefined,
    `Bearer ${memberLogin.accessToken}`,
  );
  const verdict = await call<{ valid: boolean; firstName: string | null }>(
    'POST',
    '/kiosk/check-in',
    { token },
    `Device ${deviceToken}`,
  );
  expect(verdict).toMatchObject({ valid: true, firstName: 'Γιώργος' });

  // Reception sees it live: the big card and "inside now".
  const card = desk.getByTestId('check-in-card');
  await expect(card).toContainText('Γιώργος Παπαδόπουλος');
  await expect(card).toContainText('Έγινε είσοδος');
  const inside = desk.getByRole('region', { name: /Μέσα τώρα/ });
  await expect(inside).toContainText('Γιώργος Παπαδόπουλος');

  // Reception checks them out: "inside now" is empty again.
  await desk.getByRole('button', { name: 'Έξοδος: Γιώργος Παπαδόπουλος' }).click();
  await expect(inside.getByText('Δεν υπάρχει κανείς μέσα.')).toBeVisible();

  // A revoked tablet is sent back to pairing on its next scan.
  const devices = await call<{ id: string; name: string }[]>(
    'GET',
    `/gyms/${gymId}/devices`,
    undefined,
    `Bearer ${owner.accessToken}`,
  );
  expect(devices).toHaveLength(1);
  await post(`/gyms/${gymId}/devices/${devices[0]!.id}/revoke`, {}, owner.accessToken);
  await tablet.reload();
  await expect(tablet.getByLabel('Κωδικός σύνδεσης')).toBeVisible();
  expect(await tablet.evaluate(() => localStorage.getItem('gym.kiosk.device'))).toBeNull();

  await Promise.all([tabletContext.close(), phoneContext.close(), deskContext.close()]);
});
