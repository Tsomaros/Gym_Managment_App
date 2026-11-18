import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { adminLogin } from './admin';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const API = 'http://localhost:3000';
const GYM_TZ = 'Europe/Athens';

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
  const text = await res.text();
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

/** Today in the gym's time zone and the minutes since its midnight. */
function gymNow(at = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: GYM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${v('year')}-${v('month')}-${v('day')}`,
    minutes: Number(v('hour')) * 60 + Number(v('minute')),
  };
}
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

test('members book and cancel, a full class shows Πλήρες, a booked class opens the door, a no-show is marked', async ({
  browser,
}) => {
  // The class starts ~35 minutes from now (inside the door window): not possible near midnight.
  const now = gymNow();
  test.skip(now.minutes > 22 * 60, 'needs a class that starts before midnight');
  const start = Math.ceil((now.minutes + 35) / 5) * 5;

  const run = randomUUID().slice(0, 8);
  const password = 'a long password 1';
  const email = (who: string) => `${who}-cl-${run}@example.com`;

  // Set-up through the API: gym, owner, reception, three members.
  const admin = await adminLogin();
  const { gymId } = await post<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο Μαθήματα ${run}`,
      ownerEmail: email('owner'),
      ownerFirstName: 'Άννα',
      ownerLastName: 'Ιδιοκτήτρια',
    },
    admin.accessToken,
  );
  const owner = await post<{ accessToken: string }>('/auth/accept-invite', {
    token: await inviteToken(email('owner')),
    password,
  });
  await post(
    `/gyms/${gymId}/invitations`,
    { email: email('rec'), firstName: 'Μαρία', lastName: 'Υποδοχή', roles: ['reception'] },
    owner.accessToken,
  );
  const reception = await post<{ accessToken: string }>('/auth/accept-invite', {
    token: await inviteToken(email('rec')),
    password,
  });
  const names = { m1: 'Πρώτος', m2: 'Δεύτερος', m3: 'Τρίτος' } as const;
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const { code } = await post<{ code: string }>(`/gyms/${gymId}/signup-codes`, {}, reception.accessToken);
    await post('/auth/signup', {
      code,
      firstName: names[key],
      lastName: 'Μέλος',
      email: email(key),
      phone: '6912345678',
      dateOfBirth: '1990-05-17',
      password,
      acceptPrivacy: true,
    });
  }
  const members = await call<{ userId: string; email: string }[]>(
    'GET',
    `/gyms/${gymId}/members`,
    undefined,
    `Bearer ${reception.accessToken}`,
  );
  const idOf = (key: string) => members.find((m) => m.email === email(key))!.userId;

  const pack = await post<{ id: string }>(
    `/gyms/${gymId}/membership-types`,
    { name: 'Πακέτο 1', kind: 'classes', visitCount: 1, priceCents: 1000, includesClasses: true },
    owner.accessToken,
  );
  const monthly = await post<{ id: string }>(
    `/gyms/${gymId}/membership-types`,
    {
      name: 'Μηνιαία με μαθήματα',
      kind: 'time',
      durationMonths: 1,
      priceCents: 4000,
      maxFreezeDays: 0,
      includesClasses: true,
    },
    owner.accessToken,
  );
  const sell = (key: string, typeId: string) =>
    post(
      `/gyms/${gymId}/members/${idOf(key)}/memberships`,
      { typeId, amountCents: 1000, method: 'cash', startsOn: now.date },
      reception.accessToken,
    );
  await sell('m1', pack.id);
  await sell('m2', pack.id);
  await sell('m3', monthly.id);

  // The owner defines the class: spinning, capacity 2, starting in ~35 minutes today.
  const type = await post<{ id: string }>(
    `/gyms/${gymId}/class-types`,
    { name: 'Σπινινγκ', nameEn: 'Spinning', defaultCapacity: 2, defaultDurationMinutes: 45 },
    owner.accessToken,
  );
  const session = await post<{ id: string }>(
    `/gyms/${gymId}/class-sessions`,
    {
      classTypeId: type.id,
      date: now.date,
      startsAt: hhmm(start),
      durationMinutes: 45,
      capacity: 2,
    },
    owner.accessToken,
  );

  const phone = async (key: string): Promise<Page> => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await signIn(page, email(key), password);
    await page.getByRole('link', { name: 'Μαθήματα' }).click();
    await expect(page.getByRole('heading', { name: 'Μαθήματα', level: 2 })).toBeVisible();
    return page;
  };
  const card = (page: Page) =>
    page.getByRole('heading', { name: `${hhmm(start)} Σπινινγκ` }).locator('xpath=ancestor::li[1]');

  // Members 1 and 2 book; the class is then full for member 3.
  const p1 = await phone('m1');
  await card(p1).getByRole('button', { name: /^Κράτηση/ }).click();
  await expect(card(p1).getByText('Κλεισμένο ✓')).toBeVisible();
  const p2 = await phone('m2');
  await card(p2).getByRole('button', { name: /^Κράτηση/ }).click();
  await expect(card(p2).getByText('Κλεισμένο ✓')).toBeVisible();
  const p3 = await phone('m3');
  await expect(card(p3).getByRole('button', { name: 'Πλήρες' })).toBeDisabled();

  // Member 1 cancels (inside the cut-off, with a pack: the page warns first); member 3 gets the spot.
  await card(p1).getByRole('button', { name: /^Ακύρωση/ }).click();
  const dialog = p1.getByRole('alertdialog');
  await expect(dialog).toContainText('χρεώνει μία είσοδο');
  await dialog.getByRole('button', { name: 'Ακύρωση κράτησης' }).click();
  await expect(card(p1).getByRole('button', { name: /^Κράτηση/ })).toBeVisible();
  await p3.reload();
  await p3.getByRole('link', { name: 'Μαθήματα' }).click();
  await card(p3).getByRole('button', { name: /^Κράτηση/ }).click();
  await expect(card(p3).getByText('Κλεισμένο ✓')).toBeVisible();

  // Member 2 arrives 35 minutes before: the kiosk lets a class-pack member in, the desk names the class.
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
  const deskContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await deskContext.newPage();
  await signIn(desk, email('rec'), password);
  await expect(desk.getByRole('status', { name: 'Κατάσταση σύνδεσης' })).toContainText('Ζωντανά');

  const m2 = await post<{ accessToken: string }>('/auth/login', { email: email('m2'), password });
  const { token } = await call<{ token: string }>(
    'GET',
    `/gyms/${gymId}/me/check-in-token`,
    undefined,
    `Bearer ${m2.accessToken}`,
  );
  const verdict = await call<{ valid: boolean; firstName: string | null }>(
    'POST',
    '/kiosk/check-in',
    { token },
    `Device ${deviceToken}`,
  );
  expect(verdict).toMatchObject({ valid: true, firstName: names.m2 });
  await expect(desk.getByTestId('class-line')).toContainText(`Μάθημα: Σπινινγκ ${hhmm(start)}`);

  // After the class, the no-show pass marks member 3 (who never came) and leaves member 2 attended.
  const end = new Date(Date.now() + (start + 45 - now.minutes + 31) * 60_000);
  await post('/test/classes/no-shows', { gymId, now: end.toISOString() }, admin.accessToken);
  await p2.goto(`/g/${gymId}/classes/my`);
  await expect(p2.getByRole('heading', { name: 'Παλαιότερα' })).toBeVisible();
  await expect(p2.getByText('Παρών')).toBeVisible();
  await p3.goto(`/g/${gymId}/classes/my`);
  await expect(p3.getByText('Δεν ήρθε')).toBeVisible();
  expect(session.id).toBeTruthy();

  await Promise.all([tabletContext.close(), deskContext.close()]);
});
