import type { MemberSummary } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, membership, monthlyType } from '../../test/fixtures';
import { RenewalsPage } from './RenewalsPage';

const member = (over: Partial<MemberSummary>): MemberSummary => ({
  userId: 'u1',
  photoUrl: null,
  firstName: 'Γιώργος',
  lastName: 'Παπαδόπουλος',
  email: 'g@x.gr',
  emailVerified: true,
  phone: '+306912345678',
  joinedAt: '2027-05-01T09:00:00Z',
  status: 'expiring',
  currentEndsOn: '2027-05-29',
  visitsLeft: null,
  ...over,
});

describe('RenewalsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let list: MemberSummary[];

  beforeEach(() => {
    list = [
      member({}),
      member({
        userId: 'u2',
        firstName: 'Ελένη',
        lastName: 'Νικολάου',
        phone: null,
        currentEndsOn: '2027-05-31',
      }),
      member({
        userId: 'u3',
        firstName: 'Νίκος',
        lastName: 'Αλεξίου',
        phone: '+302101234567',
        currentEndsOn: null,
        visitsLeft: 2,
      }),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/members?')) return json(200, list);
      if (url.includes('/membership-types')) return json(200, [monthlyType]);
      if (url.includes('/memberships') && init?.method === 'POST') return json(201, membership());
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/renewals`]}>
        <Routes>
          <Route path="/g/:gymId/renewals" element={<RenewalsPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('asks for the expiring members, the soonest end first, and shows them in that order', async () => {
    // The page shows the server's order as it comes. Hand it an order that is neither
    // alphabetical nor by end date, so a page that re-sorted the list itself would show up here.
    list = [list[1]!, list[0]!, list[2]!];
    renderPage();
    await screen.findByText('Γιώργος Παπαδόπουλος');
    const url = String(fetchMock.mock.calls.find(([u]) => String(u).includes('/members?'))![0]);
    expect(url).toContain('status=expiring');
    expect(url).toContain('sort=ending');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Ελένη Νικολάου'),
      expect.stringContaining('Γιώργος Παπαδόπουλος'),
      expect.stringContaining('Νίκος Αλεξίου'),
    ]);
  });

  it('shows when each one ends, or how many visits are left', async () => {
    renderPage();
    const first = (await screen.findByText('Γιώργος Παπαδόπουλος')).closest('li')!;
    expect(within(first).getByText(/29\/5\/2027/)).toBeInTheDocument();
    const third = screen.getByText('Νίκος Αλεξίου').closest('li')!;
    expect(within(third).getByText(/2 επισκέψεις/)).toBeInTheDocument();
  });

  it('gives the phone as a tel: link named after the person, and no link without a number', async () => {
    renderPage();
    const first = (await screen.findByText('Γιώργος Παπαδόπουλος')).closest('li')!;
    expect(
      within(first).getByRole('link', { name: /Κλήση: Γιώργος Παπαδόπουλος.*\+306912345678/ }),
    ).toHaveAttribute('href', 'tel:+306912345678');
    const second = screen.getByText('Ελένη Νικολάου').closest('li')!;
    expect(within(second).queryByRole('link', { name: /Κλήση/ })).not.toBeInTheDocument();
  });

  it('opens the sell dialog for that member and reloads the list after a sale', async () => {
    renderPage();
    const first = (await screen.findByText('Γιώργος Παπαδόπουλος')).closest('li')!;
    await userEvent.click(
      within(first).getByRole('button', { name: 'Πώληση: Γιώργος Παπαδόπουλος' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Μηνιαία/ }));
    const before = fetchMock.mock.calls.filter(([u]) => String(u).includes('/members?')).length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Πώληση' }));
    await screen.findByText('Η πώληση έγινε');
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).endsWith('/members/u1/memberships') && i?.method === 'POST',
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/members?')).length).toBe(
        before + 1,
      ),
    );
  });

  it('says so when nobody is about to run out', async () => {
    list = [];
    renderPage();
    expect(await screen.findByText('Κανείς δεν λήγει σύντομα.')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    await userEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByText('Γιώργος Παπαδόπουλος')).toBeInTheDocument();
  });
});
