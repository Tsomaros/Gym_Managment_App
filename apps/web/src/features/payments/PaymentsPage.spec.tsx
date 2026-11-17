import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, payment } from '../../test/fixtures';
import { PaymentsPage } from './PaymentsPage';

describe('PaymentsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const list = [
    payment({ id: 'p1', amountCents: 4000, method: 'cash' }),
    payment({ id: 'p2', amountCents: 2500, method: 'cash', memberName: 'Ελένη Νικολάου' }),
    payment({ id: 'p3', amountCents: 5000, method: 'card' }),
    payment({
      id: 'p4',
      amountCents: 9900,
      method: 'card',
      voidedAt: '2027-05-01T10:00:00Z',
      voidReason: 'Λάθος',
      voidedBy: { id: 'o', fullName: 'Άννα' },
    }),
  ];

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST' ? new Response(null, { status: 204 }) : json(200, list),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/payments`]}>
        <Routes>
          <Route path="/g/:gymId/payments" element={<PaymentsPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('totals cash and card, leaving voided payments out', async () => {
    renderPage();
    const totals = await screen.findByRole('region', { name: 'Σύνολα' });
    expect(within(totals).getByText('65,00 €')).toBeInTheDocument(); // cash 40 + 25
    expect(within(totals).getByText('50,00 €')).toBeInTheDocument(); // card, without the voided 99
    expect(within(totals).getByText('115,00 €')).toBeInTheDocument();
  });

  it('asks for today by default', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Σύνολα' });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toMatch(/\/api\/gyms\/.+\/payments\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    const from = new URL(url, 'http://x').searchParams.get('from');
    expect(new URL(url, 'http://x').searchParams.get('to')).toBe(from);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(from).toBe(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  });

  it('needs a reason before the void button works, then voids with it', async () => {
    renderPage();
    const row = (await screen.findAllByText('Γιώργος Παπαδόπουλος'))[0]!.closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Ακύρωση πληρωμής/ }));

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Ακύρωση πληρωμής' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Αιτία'), 'Λά');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Αιτία'), 'θος ποσό');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1),
    );
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/payments/p1/void`);
    expect(JSON.parse(String(init!.body))).toEqual({ reason: 'Λάθος ποσό' });
  });

  it('marks voided payments with who voided them and why, and offers no void action', async () => {
    renderPage();
    const voided = (await screen.findByText(/Λάθος/)).closest('li')!;
    expect(within(voided).getByText(/Ακυρώθηκε/)).toBeInTheDocument();
    expect(within(voided).queryByRole('button', { name: /Ακύρωση πληρωμής/ })).toBeNull();
  });

  it('moves focus to the notice after voiding (the void button is gone)', async () => {
    renderPage();
    const row = (await screen.findAllByText('Γιώργος Παπαδόπουλος'))[0]!.closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Ακύρωση πληρωμής/ }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Αιτία'), 'Λάθος ποσό');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ακύρωση πληρωμής' }));
    const notice = await screen.findByText(/Η πληρωμή ακυρώθηκε/);
    await waitFor(() => expect(notice.closest('[role="status"]')).toHaveFocus());
  });

  it('says so when the payment was already voided elsewhere (409)', async () => {
    fetchMock.mockImplementation(async (_input, init) =>
      init?.method === 'POST' ? json(409, { message: 'Payment already voided' }) : json(200, list),
    );
    renderPage();
    const row = (await screen.findAllByText('Γιώργος Παπαδόπουλος'))[0]!.closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Ακύρωση πληρωμής/ }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Αιτία'), 'Λάθος ποσό');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ακύρωση πληρωμής' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Αυτή η πληρωμή έχει ήδη ακυρωθεί.',
    );
  });
});
