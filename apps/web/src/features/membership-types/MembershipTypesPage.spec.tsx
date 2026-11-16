import type { MembershipType } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { MembershipTypesPage } from './MembershipTypesPage';

const GYM = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const monthly: MembershipType = {
  id: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
  name: 'Μηνιαία',
  nameEn: 'Monthly',
  kind: 'time',
  durationMonths: 1,
  visitCount: null,
  validityDays: null,
  priceCents: 4000,
  maxFreezeDays: 14,
  includesTrainer: true,
  includesClasses: false,
  archived: false,
};

describe('MembershipTypesPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const calls = (pattern: RegExp, method = 'GET') =>
    fetchMock.mock.calls.filter(
      ([url, init]) => pattern.test(String(url)) && (init?.method ?? 'GET') === method,
    );

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/archive')) return new Response(null, { status: 204 });
      if (url.endsWith('/membership-types') && init?.method === 'POST') return json(201, monthly);
      if (url.includes('/membership-types')) return json(200, [monthly]);
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderPage() {
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/membershipTypes`]}>
        <Routes>
          <Route path="/g/:gymId/membershipTypes" element={<MembershipTypesPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lists types with the price in Greek format and the included extras', async () => {
    renderPage();
    const row = (await screen.findByText('Μηνιαία')).closest('li')!;
    expect(within(row).getByText('40,00 €')).toBeInTheDocument();
    expect(within(row).getByText('1 μήνας')).toBeInTheDocument();
    expect(within(row).getByText('Με γυμναστή')).toBeInTheDocument();
  });

  it('shows visits instead of months when the kind is a visit pack', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέος τύπος' }));
    expect(screen.getByLabelText('Διάρκεια (μήνες)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Αριθμός επισκέψεων')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Είδος'), 'Πακέτο επισκέψεων');
    expect(screen.getByLabelText('Αριθμός επισκέψεων')).toBeInTheDocument();
    expect(screen.queryByLabelText('Διάρκεια (μήνες)')).not.toBeInTheDocument();
    // Only time-based memberships can be frozen.
    expect(screen.queryByLabelText('Μέγιστες ημέρες παγώματος')).not.toBeInTheDocument();
  });

  it('sends the price in cents when creating a type', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέος τύπος' }));
    await userEvent.type(screen.getByLabelText('Όνομα'), 'Μηνιαία');
    await userEvent.type(screen.getByLabelText('Διάρκεια (μήνες)'), '1');
    await userEvent.type(screen.getByLabelText('Τιμή (€)'), '39,50');
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));

    await waitFor(() => expect(calls(/\/membership-types$/, 'POST')).toHaveLength(1));
    const body = JSON.parse(String(calls(/\/membership-types$/, 'POST')[0]![1]!.body));
    expect(body).toMatchObject({
      name: 'Μηνιαία',
      kind: 'time',
      durationMonths: 1,
      priceCents: 3950,
    });
  });

  it('shows an error, not silence, for a price above the limit, and focuses the price field', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέος τύπος' }));
    await userEvent.type(screen.getByLabelText('Όνομα'), 'Χρυσή');
    await userEvent.type(screen.getByLabelText('Διάρκεια (μήνες)'), '12');
    await userEvent.type(screen.getByLabelText('Τιμή (€)'), '100000');
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));

    const price = screen.getByLabelText('Τιμή (€)');
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(price).toHaveFocus();
    expect(calls(/\/membership-types$/, 'POST')).toHaveLength(0);
  });

  it('keeps keyboard focus inside the archive dialog', async () => {
    renderPage();
    const row = (await screen.findByText('Μηνιαία')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Αρχειοθέτηση/ }));
    const dialog = screen.getByRole('alertdialog');
    const [cancel, confirm] = within(dialog).getAllByRole('button');
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('shows an archive failure as an error, not as a success notice', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/archive')) return json(500, {});
      return json(200, [monthly]);
    });
    renderPage();
    const row = (await screen.findByText('Μηνιαία')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Αρχειοθέτηση/ }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Αρχειοθέτηση' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
  });

  it('asks for confirmation before archiving, and archives only after it', async () => {
    renderPage();
    const row = (await screen.findByText('Μηνιαία')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Αρχειοθέτηση/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Μηνιαία/)).toBeInTheDocument();
    expect(calls(/\/archive$/, 'POST')).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls(/\/archive$/, 'POST')).toHaveLength(0);

    await userEvent.click(within(row).getByRole('button', { name: /Αρχειοθέτηση/ }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Αρχειοθέτηση' }),
    );
    await waitFor(() => expect(calls(/\/archive$/, 'POST')).toHaveLength(1));
    expect(String(calls(/\/archive$/, 'POST')[0]![0])).toBe(
      `/api/gyms/${GYM}/membership-types/${monthly.id}/archive`,
    );
  });
});
