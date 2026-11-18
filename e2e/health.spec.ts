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
  method: 'GET' | 'POST' | 'PUT',
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
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('a member consents to body measurements, the trainer records one, the member sees it, and withdrawing deletes it', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const password = 'a long password 1';
  const ownerEmail = `owner-he-${run}@example.com`;
  const receptionEmail = `rec-he-${run}@example.com`;
  const trainerEmail = `trainer-he-${run}@example.com`;
  const memberEmail = `member-he-${run}@example.com`;

  // Set-up through the API: gym, staff, a member with a trainer membership and an active plan.
  const admin = await adminLogin();
  const { gymId } = await post<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο Σώμα ${run}`,
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
  const trainer = await invite(trainerEmail, 'Νίκος', 'Γυμναστής', 'trainer');
  const staff = await call<{ staff: { userId: string; email: string }[] }>(
    'GET',
    `/gyms/${gymId}/staff`,
    undefined,
    owner.accessToken,
  );
  const trainerId = staff.staff.find((s) => s.email === trainerEmail)!.userId;
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
  await call(
    'PUT',
    `/gyms/${gymId}/members/${memberId}/trainer`,
    { trainerId },
    reception.accessToken,
  );

  // The member agrees to body measurements on the privacy page.
  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await phoneContext.newPage();
  await signIn(phone, memberEmail, password);
  await phone.goto(`/g/${gymId}/privacy`);
  const card = phone.getByRole('region', { name: 'Μετρήσεις σώματος' });
  await expect(card.getByText(/Δεν τα βλέπει ο ιδιοκτήτης ούτε η υποδοχή/)).toBeVisible();
  await card.getByRole('button', { name: 'Συμφωνώ' }).click();
  await expect(card.getByText(/Έδωσες τη συγκατάθεσή σου/)).toBeVisible();

  // The trainer opens the client's Body tab and records a measurement (a Greek comma works).
  const trainerContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const trainerPage = await trainerContext.newPage();
  await signIn(trainerPage, trainerEmail, password);
  await trainerPage.goto(`/g/${gymId}/members`);
  await trainerPage.getByRole('link', { name: 'Προγράμματα του Γιώργος Παπαδόπουλος' }).click();
  await trainerPage.getByRole('button', { name: 'Σώμα' }).click();
  const form = trainerPage.getByRole('form', { name: 'Νέα μέτρηση' });
  await form.getByLabel('Βάρος (kg)').fill('82,5');
  await form.getByLabel('Λίπος (%)').fill('18');
  await form.getByRole('button', { name: 'Αποθήκευση μέτρησης' }).click();
  await expect(trainerPage.getByText('Η μέτρηση αποθηκεύτηκε.')).toBeVisible();
  const list = trainerPage.getByRole('region', { name: 'Μετρήσεις', exact: true });
  await expect(list.getByText(/82,5 kg · 18 %/)).toBeVisible();

  // Review Focus 5: the data exists now, and still the owner and reception get 404 on it.
  const measurementsPath = `/gyms/${gymId}/members/${memberId}/measurements`;
  await expect(call('GET', measurementsPath, undefined, owner.accessToken)).rejects.toThrow(/404/);
  await expect(call('GET', measurementsPath, undefined, reception.accessToken)).rejects.toThrow(
    /404/,
  );
  // ...while the primary trainer reads it.
  expect(
    await call<unknown[]>('GET', measurementsPath, undefined, trainer.accessToken),
  ).toHaveLength(1);

  // The member sees it in the progress charts and list.
  await phone.goto(`/g/${gymId}/progress`);
  await expect(phone.getByRole('heading', { name: 'Βάρος σώματος' })).toBeVisible();
  await expect(phone.getByRole('heading', { name: 'Λίπος σώματος' })).toBeVisible();
  await expect(
    phone.getByRole('region', { name: 'Μετρήσεις', exact: true }).getByText(/82,5 kg · 18 %/),
  ).toBeVisible();

  // The member withdraws: the dialog says what goes, and confirming deletes it.
  await phone.goto(`/g/${gymId}/privacy`);
  await phone
    .getByRole('region', { name: 'Μετρήσεις σώματος' })
    .getByRole('button', { name: 'Ανάκληση' })
    .click();
  const dialog = phone.getByRole('alertdialog');
  await expect(dialog.getByText('Θα διαγραφεί οριστικά 1 μέτρηση.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Ανάκληση' }).click();
  await expect(
    phone
      .getByRole('region', { name: 'Μετρήσεις σώματος' })
      .getByRole('button', { name: 'Συμφωνώ' }),
  ).toBeVisible();

  // The trainer's tab shows none, and the form is off with the reason.
  await trainerPage.reload();
  await trainerPage.getByRole('button', { name: 'Σώμα' }).click();
  await expect(
    trainerPage.getByText('Ο πελάτης δεν έχει δώσει συγκατάθεση για μετρήσεις.'),
  ).toBeVisible();
  await expect(trainerPage.getByText(/82,5 kg · 18 %/)).toBeHidden();
  await expect(trainerPage.getByLabel('Βάρος (kg)')).toBeDisabled();
  await expect(
    trainerPage.getByText(/Δεν έχει δοθεί συγκατάθεση. Ζήτησε από τον πελάτη/),
  ).toBeVisible();

  // The API agrees: no rows, and recording again is refused.
  const login = await post<{ accessToken: string }>('/auth/login', {
    email: memberEmail,
    password,
  });
  const rows = await call<unknown[]>(
    'GET',
    `/gyms/${gymId}/me/measurements`,
    undefined,
    login.accessToken,
  );
  expect(rows).toEqual([]);
  await expect(
    post(
      `/gyms/${gymId}/members/${memberId}/measurements`,
      { measuredOn: new Date().toISOString().slice(0, 10), weightKg: 80 },
      trainer.accessToken,
    ),
  ).rejects.toThrow(/409/);

  await phoneContext.close();
  await trainerContext.close();
});
