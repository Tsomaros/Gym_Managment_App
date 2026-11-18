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

interface Session {
  id: string;
  finishedAt: string | null;
  sets: { setIndex: number; reps: number; weightKg: number; done: boolean }[];
}

test('a member logs a workout from the plan, loses the signal for the last set, and everything arrives exactly once', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const password = 'a long password 1';
  const ownerEmail = `owner-wo-${run}@example.com`;
  const receptionEmail = `rec-wo-${run}@example.com`;
  const trainerEmail = `trainer-wo-${run}@example.com`;
  const memberEmail = `member-wo-${run}@example.com`;

  // Set-up through the API: gym, staff, a member with a trainer membership and an active plan.
  const admin = await adminLogin();
  const { gymId } = await post<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο Προπόνηση ${run}`,
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
  const library = await call<{ id: string; nameEn: string | null }[]>(
    'GET',
    `/gyms/${gymId}/exercises`,
    undefined,
    trainer.accessToken,
  );
  const bench = library.find((e) => e.nameEn === 'Bench press')!;
  await post(
    `/gyms/${gymId}/members/${memberId}/plans`,
    {
      title: 'Πάνω σώμα',
      activate: true,
      days: [
        {
          title: 'Ημέρα Α',
          exercises: [
            {
              exerciseId: bench.id,
              sets: 3,
              repsMin: 8,
              repsMax: 10,
              toFailure: false,
              weightKg: 50,
              restSeconds: 90,
            },
          ],
        },
      ],
    },
    trainer.accessToken,
  );

  // The member opens the plan on a phone and starts Day A.
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await context.newPage();
  await signIn(phone, memberEmail, password);
  await phone.goto(`/g/${gymId}/myWorkouts`);
  await phone.getByRole('button', { name: /Ξεκίνα προπόνηση/ }).click();
  const card = phone.getByRole('region', { name: 'Πιέσεις στήθους' });
  await expect(card.getByText('3 × 8–10 @ 50 kg')).toBeVisible();
  await expect(phone.getByText('Αποθηκεύτηκε')).toBeVisible();

  // Two sets with a signal.
  await card.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 1' }).check();
  await card.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 2' }).check();
  await expect(phone.getByRole('timer')).toBeVisible();
  await expect(phone.getByText('Αποθηκεύτηκε')).toBeVisible();

  // No signal: the third set is queued, the screen still shows it as done.
  await context.setOffline(true);
  await card.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 3' }).check();
  await expect(phone.getByText(/Χωρίς σύνδεση — θα αποθηκευτεί \(1\)/)).toBeVisible();
  await expect(card.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 3' })).toBeChecked();

  // Signal back: the queue empties by itself.
  await context.setOffline(false);
  await expect(phone.getByText('Αποθηκεύτηκε')).toBeVisible({ timeout: 20_000 });

  await phone.getByRole('button', { name: 'Τέλος προπόνησης' }).click();
  await phone
    .getByRole('group', { name: 'Τέλος προπόνησης' })
    .getByRole('button', { name: 'Τέλος προπόνησης' })
    .click();
  await expect(phone.getByRole('heading', { name: 'Μπράβο, τελείωσες!' })).toBeVisible();
  await expect(phone.getByText('1.200 kg')).toBeVisible(); // 3 sets × 8 reps × 50 kg
  await phone.getByRole('button', { name: 'Πίσω' }).click();

  // History shows the workout with its three sets.
  await phone.goto(`/g/${gymId}/workoutHistory`);
  await expect(phone.getByText(/Πιέσεις στήθους: 50×8, 50×8, 50×8/)).toBeVisible();
  await context.close();

  // The API has exactly one finished session with exactly three sets, in order.
  const login = await post<{ accessToken: string }>('/auth/login', {
    email: memberEmail,
    password,
  });
  const sessions = await call<Session[]>(
    'GET',
    `/gyms/${gymId}/me/sessions`,
    undefined,
    login.accessToken,
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.finishedAt).not.toBeNull();
  expect(sessions[0]!.sets.map((s) => [s.setIndex, s.reps, s.weightKg, s.done])).toEqual([
    [0, 8, 50, true],
    [1, 8, 50, true],
    [2, 8, 50, true],
  ]);
});
