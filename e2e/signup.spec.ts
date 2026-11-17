import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminLogin } from './admin';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const API = 'http://localhost:3000';

/** The path of the newest link to `to` in Mailpit matching `/prefix/<token>`, e.g. /invite/abc. */
async function linkFor(to: string, prefix: string): Promise<string> {
  const pattern = new RegExp(`https?://[^/\\s]+(/${prefix}/[A-Za-z0-9_-]+)`);
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const m of messages) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string;
      };
      const match = msg.Text.match(pattern);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${prefix} email for ${to}`);
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

test('reception gives a code, a new member signs up on their phone and confirms the email', async ({
  page,
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-su-${run}@example.com`;
  const receptionEmail = `rec-su-${run}@example.com`;
  const memberEmail = `member-su-${run}@example.com`;

  // Set-up through the API: the platform admin creates a gym, its owner accepts, the owner
  // invites a receptionist.
  const admin = await adminLogin();
  const { gymId } = await api<{ gymId: string }>(
    '/platform/gyms',
    {
      name: `Γυμναστήριο ${run}`,
      ownerEmail,
      ownerFirstName: 'Νίκος',
      ownerLastName: 'Ιδιοκτήτης',
    },
    admin.accessToken,
  );
  const ownerToken = (await linkFor(ownerEmail, 'invite')).split('/').pop()!;
  const owner = await api<{ accessToken: string }>('/auth/accept-invite', {
    token: ownerToken,
    password: 'owner password 123',
  });
  await api(
    `/gyms/${gymId}/invitations`,
    { email: receptionEmail, firstName: 'Μαρία', lastName: 'Υποδοχή', roles: ['reception'] },
    owner.accessToken,
  );

  // The receptionist activates the account in the browser and lands at reception.
  await page.goto(await linkFor(receptionEmail, 'invite'));
  await page.getByLabel('Διάλεξε κωδικό').fill('reception password 1');
  await page.getByRole('button', { name: 'Ενεργοποίηση λογαριασμού' }).click();
  await expect(page.getByTestId('shell-reception')).toBeVisible();

  // Reception creates a code.
  await page.getByRole('button', { name: 'Νέος κωδικός μέλους' }).click();
  const dialog = page.getByRole('dialog', { name: 'Νέος κωδικός μέλους' });
  const codeText = dialog.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(codeText).toBeVisible();
  const code = (await codeText.textContent())!.trim();

  // The new member signs up on their own phone (a fresh browser, phone-sized).
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const member = await phone.newPage();
  await member.goto('/join');
  await member.getByLabel('Κωδικός εγγραφής').fill(code.toLowerCase().replace('-', ''));
  await member.getByLabel('Όνομα', { exact: true }).fill('Γιώργος');
  await member.getByLabel('Επώνυμο').fill('Παπαδόπουλος');
  await member.getByLabel('Email').fill(memberEmail);
  await member.getByLabel('Κινητό').fill('69 1234 5678');
  await member.getByLabel('Ημερομηνία γέννησης').fill('1990-05-17');
  await member.getByLabel('Διάλεξε κωδικό').fill('member password 1');
  await member.getByRole('checkbox', { name: /ενημέρωση απορρήτου/ }).check();
  await member.getByRole('button', { name: 'Εγγραφή' }).click();

  // Signed in as a member, asked to confirm the email.
  await expect(member.getByTestId('shell-member')).toBeVisible();
  await expect(member.getByText(/Επιβεβαίωσε το email σου/)).toBeVisible();

  // The confirmation link from the email, opened on the same phone.
  await member.goto(await linkFor(memberEmail, 'verify-email'));
  await expect(member.getByText('Το email σου επιβεβαιώθηκε.')).toBeVisible();
  await member.getByRole('link', { name: 'Συνέχεια στην εφαρμογή' }).click();
  await expect(member.getByTestId('shell-member')).toBeVisible();
  await expect(member.getByText(/Επιβεβαίωσε το email σου/)).toHaveCount(0);
  await phone.close();
});
