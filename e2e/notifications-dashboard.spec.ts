import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminLogin } from './admin';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const API = 'http://localhost:3000';
const password = 'a long password 1';

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

/** The messages in Mailpit for one recipient, each with its subject and text. */
async function mailsTo(to: string): Promise<{ Subject: string; Text: string }[]> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
  return Promise.all(
    messages.map(async (m) => {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string;
      };
      return { Subject: m.Subject, Text: msg.Text };
    }),
  );
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH',
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

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

test('a reminder reaches a member once, the gym shows how busy it is, and the owner sees the day', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-nd-${run}@example.com`;
  const emails = ['a', 'b', 'c'].map((n) => `member-${n}-nd-${run}@example.com`);

  // Set-up through the API: a gym, its owner, capacity 5 and a 5-day reminder, three members.
  const admin = await adminLogin();
  const { gymId } = await call<{ gymId: string }>(
    'POST',
    '/platform/gyms',
    {
      name: `Γυμναστήριο Ειδοποιήσεις ${run}`,
      ownerEmail,
      ownerFirstName: 'Άννα',
      ownerLastName: 'Ιδιοκτήτρια',
    },
    admin.accessToken,
  );
  const owner = await call<{ accessToken: string }>('POST', '/auth/accept-invite', {
    token: await inviteToken(ownerEmail),
    password,
  });
  await call(
    'PATCH',
    `/gyms/${gymId}/settings`,
    { capacity: 5, reminderDays: 5 },
    owner.accessToken,
  );
  const type = await call<{ id: string }>(
    'POST',
    `/gyms/${gymId}/membership-types`,
    { name: 'Μηνιαία', kind: 'time', durationMonths: 1, priceCents: 4000, maxFreezeDays: 0 },
    owner.accessToken,
  );
  // Members come in by invitation, not by sign-up: the sign-up route is throttled per IP and the
  // specs run in parallel from one machine.
  for (const [i, email] of emails.entries()) {
    await call(
      'POST',
      `/gyms/${gymId}/invitations`,
      { email, firstName: `Μέλος${i}`, lastName: 'Δοκιμή', roles: ['member'] },
      owner.accessToken,
    );
    await call('POST', '/auth/accept-invite', { token: await inviteToken(email), password });
  }
  const list = await call<{ userId: string; email: string }[]>(
    'GET',
    `/gyms/${gymId}/members`,
    undefined,
    owner.accessToken,
  );
  const idOf = (email: string) => list.find((m) => m.email === email)!.userId;
  const sold: { effectiveEndsOn: string }[] = [];
  for (const email of emails) {
    sold.push(
      await call(
        'POST',
        `/gyms/${gymId}/members/${idOf(email)}/memberships`,
        { typeId: type.id, amountCents: 4000, method: 'card' },
        owner.accessToken,
      ),
    );
  }

  // The reminders run on the day 5 days before the end, after 10:00 in Athens (09:00 UTC is 12:00).
  const remindOn = `${addDays(sold[0]!.effectiveEndsOn, -5)}T09:00:00.000Z`;
  const runReminders = () =>
    call<{ sent: number; duplicate: number }>(
      'POST',
      '/test/reminders/run',
      { gymId, now: remindOn },
      admin.accessToken,
    );
  const first = await runReminders();
  expect(first.sent).toBe(3);
  // The sign-up confirmation is in the inbox too: count only the reminders.
  const reminders = async (email: string) =>
    (await mailsTo(email)).filter((m) => m.Subject.includes('λήγει σύντομα'));
  const inbox = await reminders(emails[0]!);
  expect(inbox).toHaveLength(1);
  expect(inbox[0]!.Subject).toContain('λήγει σύντομα');
  expect(inbox[0]!.Text).toContain('/settings/notifications');
  // A second run, as after a restart, sends nothing more to anyone.
  const second = await runReminders();
  expect(second).toMatchObject({ sent: 0, duplicate: 3 });
  for (const email of emails) expect(await reminders(email)).toHaveLength(1);

  // Three members are let in at the desk: 3 of 5 is "moderate".
  for (const email of emails) {
    const verdict = await call<{ valid: boolean }>(
      'POST',
      `/gyms/${gymId}/members/${idOf(email)}/check-ins`,
      {},
      owner.accessToken,
    );
    expect(verdict.valid).toBe(true);
  }

  // A member opens the app on their phone: "Μέτρια", and no number, because the owner left it off.
  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await phoneContext.newPage();
  await phone.goto('/login');
  await phone.getByLabel('Email').fill(emails[0]!);
  await phone.getByLabel('Κωδικός').fill(password);
  await phone.getByRole('button', { name: 'Σύνδεση' }).click();
  const badge = phone.getByTestId('occupancy-badge');
  await expect(badge).toContainText('Μέτρια');
  await expect(badge).toBeVisible();
  await expect(badge).not.toContainText('άτομα');

  // The emailed settings link opens the member's notification settings.
  await phone.goto('/settings/notifications');
  await expect(phone.getByRole('heading', { name: 'Ειδοποιήσεις', level: 2 })).toBeVisible();
  await expect(phone.getByRole('switch', { name: 'Συνδρομή: Email' })).toBeChecked();

  // The owner's home is the dashboard: three visitors today, 120 euros this month.
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/login');
  await ownerPage.getByLabel('Email').fill(ownerEmail);
  await ownerPage.getByLabel('Κωδικός').fill(password);
  await ownerPage.getByRole('button', { name: 'Σύνδεση' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Σήμερα' })).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: /Επισκέπτες σήμερα/ })).toContainText('3');
  await expect(ownerPage.getByRole('link', { name: /Μέσα τώρα/ })).toContainText('3');
  await expect(ownerPage.getByText(/120,00 € στον τρέχοντα μήνα/)).toBeVisible();
  // Reception's desk shows the count out of the capacity.
  await ownerPage.getByRole('link', { name: 'Είσοδοι' }).click();
  await expect(ownerPage.getByRole('heading', { name: /Μέσα τώρα/ })).toContainText('3 / 5');
});
