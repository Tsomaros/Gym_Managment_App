import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

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
  bearer?: string,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
const post = <T>(path: string, body: unknown, bearer?: string) =>
  call<T>('POST', path, body, bearer);

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Κωδικός').fill(password);
  await page.getByRole('button', { name: 'Σύνδεση' }).click();
  // Leave the login page before the test navigates on: the session is ready then.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('a trainer is off shift at check-in, reception assigns the on-duty trainer as cover, who then sees the member', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const password = 'a long password 1';
  const ownerEmail = `owner-ss-${run}@example.com`;
  const receptionEmail = `rec-ss-${run}@example.com`;
  const trainerAEmail = `trainer-a-ss-${run}@example.com`;
  const trainerBEmail = `trainer-b-ss-${run}@example.com`;
  const memberEmail = `member-ss-${run}@example.com`;

  // Set-up through the API: gym, owner, reception, two trainers, a member with a trainer membership.
  const admin = await post<{ accessToken: string }>('/auth/login', {
    email: process.env.PLATFORM_ADMIN_EMAIL,
    password: process.env.PLATFORM_ADMIN_PASSWORD,
  });
  const { gymId } = await post<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο Βάρδιες ${run}`,
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
  const invite = async (email: string, firstName: string, lastName: string, role: string) => {
    await post(
      `/gyms/${gymId}/invitations`,
      { email, firstName, lastName, roles: [role] },
      owner.accessToken,
    );
    return post<{ accessToken: string }>('/auth/accept-invite', {
      token: await inviteToken(email),
      password,
    });
  };
  const reception = await invite(receptionEmail, 'Μαρία', 'Υποδοχή', 'reception');
  await invite(trainerAEmail, 'Νίκος', 'Αλφα', 'trainer');
  await invite(trainerBEmail, 'Ελένη', 'Βήτα', 'trainer');

  const staff = await call<{ staff: { userId: string; email: string }[] }>(
    'GET',
    `/gyms/${gymId}/staff`,
    undefined,
    owner.accessToken,
  );
  const trainerBId = staff.staff.find((s) => s.email === trainerBEmail)!.userId;

  // B works all day today (gym date); A has no shift today.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
  await post(
    `/gyms/${gymId}/shifts`,
    { staffId: trainerBId, date: today, startsAt: '00:00', endsAt: '23:55' },
    owner.accessToken,
  );

  const { code } = await post<{ code: string }>(
    `/gyms/${gymId}/signup-codes`,
    {},
    reception.accessToken,
  );
  await post('/auth/signup', {
    code,
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
      name: 'Με γυμναστή',
      kind: 'time',
      durationMonths: 1,
      priceCents: 6000,
      maxFreezeDays: 0,
      includesTrainer: true,
    },
    owner.accessToken,
  );
  const members = await call<{ userId: string; email: string }[]>(
    'GET',
    `/gyms/${gymId}/members`,
    undefined,
    reception.accessToken,
  );
  const memberId = members.find((m) => m.email === memberEmail)!.userId;
  await post(
    `/gyms/${gymId}/members/${memberId}/memberships`,
    { typeId: type.id, amountCents: 6000, method: 'cash' },
    reception.accessToken,
  );

  // The owner sees both trainers on the staff page.
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.goto(`/g/${gymId}/staff`);
  await expect(ownerPage.getByText('Νίκος Αλφα')).toBeVisible();
  await expect(ownerPage.getByText('Ελένη Βήτα')).toBeVisible();

  // Reception assigns trainer A (not on shift) to the member and checks them in.
  const recContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rec = await recContext.newPage();
  await signIn(rec, receptionEmail, password);
  await rec.goto(`/g/${gymId}/members/${memberId}`);
  await rec.getByRole('button', { name: 'Ανάθεση γυμναστή' }).click();
  const assign = rec.getByRole('dialog', { name: /Γυμναστής για/ });
  await assign.getByRole('radio', { name: /Νίκος Αλφα/ }).check();
  await assign.getByRole('button', { name: 'Ανάθεση', exact: true }).click();
  await expect(rec.getByText('Νίκος Αλφα')).toBeVisible();

  await rec.getByRole('button', { name: 'Είσοδος', exact: true }).click();
  const card = rec.getByTestId('check-in-card');
  await expect(card).toContainText('Γυμναστής: Νίκος (εκτός βάρδιας)');

  // Reception assigns the on-duty trainer B as today's cover.
  await card.getByRole('button', { name: 'Ανάθεση αντικαταστάτη' }).click();
  const coverDialog = rec.getByRole('dialog', { name: /Αντικαταστάτης για/ });
  await expect(coverDialog.getByRole('button', { name: /Νίκος/ })).toHaveCount(0);
  await coverDialog.getByRole('button', { name: /Ελένη Βήτα/ }).click();
  await expect(card).toContainText('Αντικαταστάτης σήμερα: Ελένη');

  // B signs in and sees the member under today's covers.
  const trainerContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const trainer = await trainerContext.newPage();
  await signIn(trainer, trainerBEmail, password);
  await trainer.goto(`/g/${gymId}/members`);
  const covers = trainer.getByRole('region', { name: 'Αντικατάσταση σήμερα' });
  await expect(covers).toContainText('Γιώργος Παπαδόπουλος');

  await Promise.all([ownerContext.close(), recContext.close(), trainerContext.close()]);
});
