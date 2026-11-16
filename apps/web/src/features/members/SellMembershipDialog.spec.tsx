import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, MEMBER, membership, monthlyType } from '../../test/fixtures';
import { SellMembershipDialog } from './SellMembershipDialog';

const dayPass = {
  ...monthlyType,
  id: 'd1',
  name: 'Ημερήσια',
  kind: 'day_pass' as const,
  durationMonths: null,
  priceCents: 800,
  maxFreezeDays: 0,
};

describe('SellMembershipDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const sales = () => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'POST');

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST'
        ? json(
            201,
            membership({
              startsOn: '2027-06-01',
              endsOn: '2027-06-30',
              effectiveEndsOn: '2027-06-30',
            }),
          )
        : json(200, [monthlyType, dayPass]),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = () =>
    render(
      <SellMembershipDialog
        gymId={GYM}
        memberId={MEMBER}
        memberName="Γιώργος Παπαδόπουλος"
        onClose={vi.fn()}
        onSold={vi.fn()}
      />,
    );

  it('prefills the amount with the chosen type price, editable for a discount', async () => {
    open();
    await userEvent.click(await screen.findByRole('radio', { name: /Μηνιαία/ }));
    expect(screen.getByLabelText('Ποσό (€)')).toHaveValue('40,00');
    await userEvent.click(screen.getByRole('radio', { name: /Ημερήσια/ }));
    expect(screen.getByLabelText('Ποσό (€)')).toHaveValue('8,00');
  });

  it('defaults to cash, sends card when chosen, and the discounted amount in cents', async () => {
    open();
    await userEvent.click(await screen.findByRole('radio', { name: /Μηνιαία/ }));
    expect(screen.getByRole('radio', { name: 'Μετρητά' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Κάρτα' }));
    const amount = screen.getByLabelText('Ποσό (€)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '35');
    await userEvent.click(screen.getByRole('button', { name: 'Πώληση' }));

    await waitFor(() => expect(sales()).toHaveLength(1));
    const [url, init] = sales()[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/members/${MEMBER}/memberships`);
    expect(JSON.parse(String(init!.body))).toEqual({
      typeId: monthlyType.id,
      amountCents: 3500,
      method: 'card',
    });
  });

  it('shows the start and end the API decided after the sale', async () => {
    open();
    await userEvent.click(await screen.findByRole('radio', { name: /Μηνιαία/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Πώληση' }));
    expect(await screen.findByText(/1\/6\/2027/)).toBeInTheDocument();
    expect(screen.getByText(/30\/6\/2027/)).toBeInTheDocument();
  });

  it('sends nothing until a type is chosen', async () => {
    open();
    await screen.findByRole('radio', { name: /Μηνιαία/ });
    await userEvent.click(screen.getByRole('button', { name: 'Πώληση' }));
    expect(sales()).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Διάλεξε τύπο συνδρομής.');
  });
});
