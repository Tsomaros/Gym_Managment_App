import type { AuditEntry } from '@gym/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { HistoryPage } from './HistoryPage';

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: '1',
  action: 'membership.sold',
  entity: 'membership',
  entityId: null,
  actor: { id: 'r', fullName: 'Μαρία Υποδοχή' },
  data: {},
  at: '2027-05-01T09:00:00.000Z',
  ...over,
});

describe('HistoryPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('before=')
        ? json(200, {
            entries: [entry({ id: '1', action: 'signup_code.issued', entity: 'signup_code' })],
            nextBefore: null,
          })
        : json(200, {
            entries: [
              entry({
                id: '3',
                action: 'membership.sold',
                data: {
                  typeName: 'Μηνιαία',
                  amountCents: 4000,
                  method: 'cash',
                  memberName: 'Γιώργος Μέλος',
                },
              }),
              entry({
                id: '2',
                action: 'payment.voided',
                actor: { id: 'o', fullName: 'Άννα Ιδιοκτήτρια' },
                data: { amountCents: 4000, reason: 'Λάθος ποσό' },
              }),
            ],
            nextBefore: '2',
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/history`]}>
        <Routes>
          <Route path="/g/:gymId/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('writes each entry as a readable sentence, newest first', async () => {
    renderPage();
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Μαρία Υποδοχή πούλησε «Μηνιαία» — 40,00 €, μετρητά');
    expect(items[1]).toHaveTextContent(
      'Άννα Ιδιοκτήτρια ακύρωσε μια πληρωμή 40,00 € — «Λάθος ποσό»',
    );
  });

  it('loads older entries with "load more" and hides it at the end', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Περισσότερα' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(String(fetchMock.mock.calls[1]![0])).toContain('before=2');
    expect(screen.queryByRole('button', { name: 'Περισσότερα' })).toBeNull();
  });
});
