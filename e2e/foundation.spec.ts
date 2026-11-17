import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Waits for the newest email to `to` in Mailpit and returns its invite path (/invite/<token>). */
async function inviteLinkFor(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages[0]) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as {
        Text: string;
      };
      const match = msg.Text.match(/https?:\/\/[^/\s]+(\/invite\/[A-Za-z0-9_-]+)/);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no invite email for ${to}`);
}

test('platform admin creates a gym, the owner accepts the emailed invite and lands in Greek', async ({
  page,
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const gymName = `Γυμναστήριο Ναυπάκτου ${run}`;
  const ownerEmail = `owner-e2e-${run}@example.com`;

  // Platform admin (seeded from .env at API start) signs in and creates the gym.
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.PLATFORM_ADMIN_EMAIL!);
  await page.getByLabel('Κωδικός').fill(process.env.PLATFORM_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Σύνδεση' }).click();
  await expect(page.getByTestId('shell-platform')).toBeVisible();

  await page.getByLabel('Όνομα γυμναστηρίου').fill(gymName);
  await page.getByLabel('Email ιδιοκτήτη').fill(ownerEmail);
  await page.getByLabel('Όνομα ιδιοκτήτη').fill('Νίκος');
  await page.getByLabel('Επώνυμο ιδιοκτήτη').fill('Ιδιοκτήτης');
  await page.getByRole('button', { name: 'Δημιουργία' }).click();
  await expect(page.getByRole('status')).toContainText(ownerEmail);

  // The owner opens the emailed link in a fresh browser (no admin session, no stored language).
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto(await inviteLinkFor(ownerEmail));
  await expect(owner.getByRole('heading', { name: `Πρόσκληση στο ${gymName}` })).toBeVisible();
  await owner.getByLabel('Διάλεξε κωδικό').fill('owner password 123');
  await owner.getByRole('button', { name: 'Ενεργοποίηση λογαριασμού' }).click();

  // Lands in the owner area, in Greek.
  const shell = owner.getByTestId('shell-owner');
  await expect(shell).toBeVisible();
  await expect(shell.getByText(gymName)).toBeVisible();
  const nav = owner.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Επισκόπηση' })).toBeVisible();

  // Switching to English changes the navigation language.
  await owner.getByRole('button', { name: 'English' }).click();
  await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Επισκόπηση' })).toHaveCount(0);

  // The session survives a reload (refresh cookie through the same-origin /api proxy).
  await owner.reload();
  await expect(owner.getByTestId('shell-owner')).toBeVisible();
  await expect(owner.getByRole('navigation').getByRole('link', { name: 'Overview' })).toBeVisible();
  await ownerContext.close();
});
