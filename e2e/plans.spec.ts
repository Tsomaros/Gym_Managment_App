import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';

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
  // Leave the login page before the test navigates on: the session is ready then.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** Searches the library picker and picks the first match once the filtered list has arrived. */
async function pickExercise(page: Page, addButton: Locator, search: string, name: string) {
  await addButton.click();
  const picker = page.getByRole('dialog', { name: 'Επιλογή άσκησης' });
  await picker.getByRole('combobox').fill(search);
  // The list is "busy" while the typed text has not been answered yet; picking waits for that.
  await expect(picker.getByRole('listbox')).toHaveAttribute('aria-busy', 'false');
  await picker.getByRole('option', { name: new RegExp(`^${name}$`) }).click();
  await expect(picker).toBeHidden();
}

test('a trainer builds a two-day plan from scratch, activates it, saves it as a template and uploads a PDF plan for another client', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const password = 'a long password 1';
  const ownerEmail = `owner-pl-${run}@example.com`;
  const receptionEmail = `rec-pl-${run}@example.com`;
  const trainerEmail = `trainer-pl-${run}@example.com`;
  const memberAEmail = `member-a-pl-${run}@example.com`;
  const memberBEmail = `member-b-pl-${run}@example.com`;

  // Set-up through the API: gym, owner, reception, a trainer, two members with trainer memberships.
  const admin = await post<{ accessToken: string }>('/auth/login', {
    email: process.env.PLATFORM_ADMIN_EMAIL,
    password: process.env.PLATFORM_ADMIN_PASSWORD,
  });
  const { gymId } = await post<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο Προγράμματα ${run}`,
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
  await invite(trainerEmail, 'Νίκος', 'Γυμναστής', 'trainer');
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
  const memberIds: Record<string, string> = {};
  for (const [key, email, firstName, lastName] of [
    ['a', memberAEmail, 'Γιώργος', 'Παπαδόπουλος'],
    ['b', memberBEmail, 'Ελένη', 'Νικολάου'],
  ] as const) {
    const { code } = await post<{ code: string }>(
      `/gyms/${gymId}/signup-codes`,
      {},
      reception.accessToken,
    );
    await post('/auth/signup', {
      code,
      firstName,
      lastName,
      email,
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
    const memberId = members.find((m) => m.email === email)!.userId;
    memberIds[key] = memberId;
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
  }

  // The trainer opens client A's plans and builds a plan from scratch, on a tablet.
  const trainerContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const trainer = await trainerContext.newPage();
  await signIn(trainer, trainerEmail, password);
  await trainer.goto(`/g/${gymId}/members`);
  await trainer.getByRole('link', { name: 'Προγράμματα του Γιώργος Παπαδόπουλος' }).click();
  await expect(trainer.getByText('Δεν υπάρχει ενεργό πρόγραμμα.')).toBeVisible();
  await trainer.getByRole('button', { name: 'Νέο πρόγραμμα' }).click();
  await trainer.getByRole('button', { name: /Κενό πρόγραμμα/ }).click();

  await trainer.getByLabel('Τίτλος προγράμματος').fill('Πάνω σώμα και κορμός');
  await pickExercise(
    trainer,
    trainer.getByRole('button', { name: 'Προσθήκη άσκησης στην ημέρα «Ημέρα Α»' }),
    'πιεσεις',
    'Πιέσεις στήθους Στήθος',
  );
  const bench = trainer.getByRole('group', { name: 'Στοιχεία άσκησης «Πιέσεις στήθους»' });
  await bench.getByLabel('Σετ').fill('4');
  await bench.getByLabel('Επαναλήψεις από').fill('8');
  await bench.getByLabel('έως').fill('10');
  await bench.getByLabel('Βάρος (kg)').fill('52.5');

  await trainer.getByRole('button', { name: 'Προσθήκη ημέρας' }).click();
  await trainer.getByLabel('Όνομα ημέρας').last().fill('Ημέρα Β');
  await pickExercise(
    trainer,
    trainer.getByRole('button', { name: 'Προσθήκη άσκησης στην ημέρα «Ημέρα Β»' }),
    'σανιδα',
    'Σανίδα Κορμός',
  );
  await trainer
    .getByRole('group', { name: 'Στοιχεία άσκησης «Σανίδα»' })
    .getByLabel('Διάρκεια (δευτ.)')
    .fill('45');

  await trainer.getByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' }).click();
  await expect(trainer.getByRole('heading', { name: 'Πάνω σώμα και κορμός' })).toBeVisible();
  await expect(trainer.getByText('4 × 8–10 @ 52,5 kg')).toBeVisible();
  await expect(trainer.getByText('3 × 45″')).toBeVisible();
  await expect(trainer.getByRole('heading', { name: 'Ενεργό', level: 3 })).toBeVisible();

  // Save it as a template, from the editor.
  await trainer.getByRole('button', { name: 'Επεξεργασία' }).click();
  await trainer.getByRole('button', { name: 'Αποθήκευση ως πρότυπο' }).click();
  await expect(
    trainer.getByText('✓ Αποθηκεύτηκε ως πρότυπο «Πάνω σώμα και κορμός».'),
  ).toBeVisible();
  await trainer.getByRole('button', { name: 'Κλείσιμο' }).click();

  // The template shows on the plans page.
  await trainer.goto(`/g/${gymId}/plans`);
  const templateRow = trainer.getByRole('listitem', { name: 'Πάνω σώμα και κορμός' });
  await expect(templateRow).toBeVisible();
  await expect(templateRow.getByText('Δικό σου')).toBeVisible();

  // Client B gets a PDF plan.
  await trainer.goto(`/g/${gymId}/members`);
  await trainer.getByRole('link', { name: 'Προγράμματα του Ελένη Νικολάου' }).click();
  await trainer.getByRole('button', { name: 'Νέο πρόγραμμα' }).click();
  await trainer.getByRole('button', { name: /Αρχείο PDF/ }).click();
  await trainer.getByLabel('Τίτλος', { exact: true }).fill('Πρόγραμμα από τον διατροφολόγο');
  await trainer.getByLabel('Αρχείο PDF').setInputFiles({
    name: 'programma.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  });
  await trainer.getByLabel('Ενεργοποίηση αμέσως').check();
  await trainer.getByRole('button', { name: 'Αποστολή' }).click();
  await expect(
    trainer.getByRole('heading', { name: 'Πρόγραμμα από τον διατροφολόγο' }),
  ).toBeVisible();
  await expect(trainer.getByRole('link', { name: 'Άνοιγμα PDF' })).toBeVisible();

  await trainerContext.close();

  // Client A reads the plan on a phone: the days are tabs, the layout is one column.
  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await phoneContext.newPage();
  await signIn(phone, memberAEmail, password);
  await phone.goto(`/g/${gymId}/myWorkouts`);
  await expect(phone.getByRole('heading', { name: 'Το πρόγραμμά μου' })).toBeVisible();
  await expect(phone.getByRole('heading', { name: 'Πάνω σώμα και κορμός' })).toBeVisible();
  const tabs = phone.getByRole('tab');
  await expect(tabs).toHaveText(['Ημέρα Α', 'Ημέρα Β']);
  await expect(phone.getByText('4 × 8–10 @ 52,5 kg')).toBeVisible();
  await tabs.nth(1).click();
  await expect(phone.getByText('3 × 45″')).toBeVisible();
  await expect(phone.getByText('4 × 8–10 @ 52,5 kg')).toBeHidden();
  // One column: nothing makes the page wider than the phone.
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await phoneContext.close();

  // Client B opens the PDF plan from the phone too.
  const phoneBContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phoneB = await phoneBContext.newPage();
  await signIn(phoneB, memberBEmail, password);
  await phoneB.goto(`/g/${gymId}/myWorkouts`);
  const openPdf = phoneB.getByRole('link', { name: 'Άνοιγμα PDF' });
  await expect(openPdf).toBeVisible();
  await expect(openPdf).toHaveAttribute('target', '_blank');
  const pdfResponse = await phoneB.request.get((await openPdf.getAttribute('href'))!);
  expect(pdfResponse.status()).toBe(200);
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await phoneBContext.close();
});
