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

async function api<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Κωδικός').fill(password);
  await page.getByRole('button', { name: 'Σύνδεση' }).click();
}

/** Today in Athens (the gym's time zone) as YYYY-MM-DD, offset by `days`. */
function athensDay(days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('owner sets a type, reception sells and freezes, the member sees it, the owner voids it', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-ms-${run}@example.com`;
  const receptionEmail = `rec-ms-${run}@example.com`;
  const memberEmail = `member-ms-${run}@example.com`;
  const password = 'a long password 1';

  // Set-up through the API: gym, owner, receptionist, and a member who signed up with a code.
  const admin = await adminLogin();
  const { gymId } = await api<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο ${run}`,
      ownerEmail,
      ownerFirstName: 'Άννα',
      ownerLastName: 'Ιδιοκτήτρια',
    },
    admin.accessToken,
  );
  const owner = await api<{ accessToken: string }>('/auth/accept-invite', {
    token: await inviteToken(ownerEmail),
    password,
  });
  await api(
    `/gyms/${gymId}/invitations`,
    { email: receptionEmail, firstName: 'Μαρία', lastName: 'Υποδοχή', roles: ['reception'] },
    owner.accessToken,
  );
  const reception = await api<{ accessToken: string }>('/auth/accept-invite', {
    token: await inviteToken(receptionEmail),
    password,
  });
  const { code } = await api<{ code: string }>(
    `/gyms/${gymId}/signup-codes`,
    {},
    reception.accessToken,
  );
  await api('/auth/signup', {
    code,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    email: memberEmail,
    phone: '6912345678',
    dateOfBirth: '1990-05-17',
    password,
    acceptPrivacy: true,
  });

  // The owner creates a monthly membership type.
  const ownerPage = await (await browser.newContext()).newPage();
  await signIn(ownerPage, ownerEmail, password);
  await ownerPage.getByRole('link', { name: 'Τύποι συνδρομής' }).click();
  await ownerPage.getByRole('button', { name: 'Νέος τύπος' }).click();
  await ownerPage.getByLabel('Όνομα', { exact: true }).fill('Μηνιαία');
  await ownerPage.getByLabel('Διάρκεια (μήνες)').fill('1');
  await ownerPage.getByLabel('Τιμή (€)').fill('40');
  await ownerPage.getByLabel('Μέγιστες ημέρες παγώματος').fill('14');
  await ownerPage.getByRole('button', { name: 'Αποθήκευση' }).click();
  await expect(ownerPage.getByText('40,00 €')).toBeVisible();

  // Reception sells it to the member.
  const desk = await (await browser.newContext()).newPage();
  await signIn(desk, receptionEmail, password);
  await desk.getByRole('link', { name: 'Μέλη' }).click();
  await desk.getByRole('link', { name: /Γιώργος Παπαδόπουλος/ }).click();
  await desk.getByRole('button', { name: 'Νέα συνδρομή' }).click();
  await desk.getByRole('radio', { name: /Μηνιαία/ }).check();
  await expect(desk.getByLabel('Ποσό (€)')).toHaveValue('40,00');
  await desk.getByRole('button', { name: 'Πώληση' }).click();
  await expect(desk.getByText('Η πώληση έγινε')).toBeVisible();
  await desk.getByRole('button', { name: 'Κλείσιμο' }).click();

  // The member sees the days remaining.
  const phone = await (
    await browser.newContext({ viewport: { width: 375, height: 812 } })
  ).newPage();
  await signIn(phone, memberEmail, password);
  // The member's home is the check-in code; the full membership card is one tap away.
  await phone.getByRole('link', { name: 'Η συνδρομή μου' }).click();
  await expect(phone.getByText(/^\d+ ημέρες$/)).toBeVisible();

  // Reception freezes it from today for three days.
  await desk.getByRole('button', { name: /Πάγωμα «Μηνιαία»/ }).click();
  await desk.getByLabel('Από').fill(athensDay(0));
  await desk.getByLabel('Έως').fill(athensDay(2));
  await desk.getByRole('button', { name: 'Πάγωμα', exact: true }).click();
  await expect(desk.getByRole('dialog')).toHaveCount(0);

  await phone.reload();
  await expect(phone.getByText('Σε πάγωμα')).toBeVisible();
  await expect(phone.getByText(/Νέα λήξη:/)).toBeVisible();

  // The owner voids the payment.
  await ownerPage.getByRole('link', { name: 'Πληρωμές' }).click();
  await ownerPage.getByRole('button', { name: /Ακύρωση πληρωμής: Γιώργος Παπαδόπουλος/ }).click();
  await ownerPage.getByLabel('Αιτία').fill('Λάθος μέλος');
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Ακύρωση πληρωμής' }).click();
  await expect(ownerPage.getByText(/Ακυρώθηκε από Άννα Ιδιοκτήτρια/)).toBeVisible();

  await phone.reload();
  await expect(phone.getByText('Δεν έχεις ενεργή συνδρομή.')).toBeVisible();

  // The history tells the story.
  await ownerPage.getByRole('link', { name: 'Ιστορικό' }).click();
  await expect(
    ownerPage.getByText(/Μαρία Υποδοχή πούλησε «Μηνιαία» — 40,00 €, μετρητά/),
  ).toBeVisible();
  await expect(ownerPage.getByText(/Μαρία Υποδοχή πάγωσε μια συνδρομή/)).toBeVisible();
  await expect(ownerPage.getByText(/Άννα Ιδιοκτήτρια ακύρωσε μια πληρωμή 40,00 €/)).toBeVisible();
});
