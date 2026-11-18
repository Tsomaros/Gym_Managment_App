import type { BookingStatus, BookingView } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { MyBookingsPage } from './MyBookingsPage';
import { NextClassCard } from './NextClassCard';
import { classSession } from './test-data';

const booking = (
  id: string,
  status: BookingStatus,
  over: Partial<BookingView> = {},
  date = '2027-05-18',
): BookingView => {
  const { id: sessionId, date: d, startsAt, endsAt, type, trainer, room, capacity, cancelled } =
    classSession({ id: `s-${id}`, date, startsAt: '18:00' });
  return {
    id,
    status,
    usesEntry: false,
    late: false,
    session: { id: sessionId, date: d, startsAt, endsAt, type, trainer, room, capacity, cancelled },
    ...over,
  };
};

describe('MyBookingsPage and NextClassCard', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let upcoming: BookingView[];
  let all: BookingView[];

  beforeEach(() => {
    upcoming = [booking('u1', 'booked'), booking('u2', 'booked', { usesEntry: true, late: true }, '2027-05-20')];
    all = [
      ...upcoming,
      booking('p1', 'attended', {}, '2027-05-10'),
      booking('p2', 'no_show', {}, '2027-05-09'),
      booking('p3', 'cancelled', {}, '2027-05-08'),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'DELETE') return json(200, { status: 'cancelled' });
      return json(200, String(input).endsWith('upcoming=true') ? upcoming : all);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderIn = (el: React.ReactNode) =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/classes/my`]}>
        <Routes>
          <Route path="/g/:gymId/classes/my" element={el} />
        </Routes>
      </MemoryRouter>,
    );

  it('lists upcoming bookings and, apart, what happened to the earlier ones', async () => {
    renderIn(<MyBookingsPage />);
    const next = await screen.findByRole('heading', { name: 'Επόμενα' });
    expect(next).toBeVisible();
    const nextList = next.nextElementSibling as HTMLElement;
    expect(within(nextList).getAllByRole('listitem')).toHaveLength(2);
    const history = screen.getByRole('heading', { name: 'Παλαιότερα' }).nextElementSibling as HTMLElement;
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(3); // the upcoming ones are not repeated
    expect(rows[0]).toHaveTextContent('Παρών');
    expect(rows[1]).toHaveTextContent('Δεν ήρθε');
    expect(rows[2]).toHaveTextContent('Ακυρώθηκε');
  });

  it('cancelling asks first; a late pack booking warns about the entry, then deletes and reloads', async () => {
    renderIn(<MyBookingsPage />);
    const buttons = await screen.findAllByRole('button', { name: /^Ακύρωση/ });
    await userEvent.click(buttons[1]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/χρεώνει μία είσοδο/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ακύρωση κράτησης' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(true),
    );
    const del = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
    expect(String(del[0])).toBe(`/api/gyms/${GYM}/me/bookings/u2`);
    // ...and the lists are fetched again (2 before the cancel, 2 after).
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, i]) => i?.method !== 'DELETE')).toHaveLength(4),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Η κράτηση ακυρώθηκε');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Οι κρατήσεις μου', level: 2 })).toHaveFocus(),
    );
  });

  it('says so when there are no bookings, and when loading fails', async () => {
    upcoming = [];
    all = [];
    const { unmount } = renderIn(<MyBookingsPage />);
    expect(await screen.findByText('Δεν έχεις κρατήσεις.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Παλαιότερα' })).not.toBeInTheDocument();
    unmount();
    fetchMock.mockImplementation(async () => json(500, {}));
    renderIn(<MyBookingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
  });

  it('the home card names the next booked class and links to the bookings', async () => {
    renderIn(<NextClassCard />);
    expect(
      await screen.findByText('Επόμενο μάθημα: Σπινινγκ, Τρίτη 18:00'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Οι κρατήσεις μου' })).toHaveAttribute(
      'href',
      `/g/${GYM}/classes/my`,
    );
  });

  it('the home card is absent without a booking or when loading fails', async () => {
    // Let the response arrive and React re-render before looking: otherwise "empty" is just "not loaded yet".
    const settled = async () => {
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    };
    upcoming = [];
    const { container, unmount } = renderIn(<NextClassCard />);
    await settled();
    expect(container).toBeEmptyDOMElement();
    unmount();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => json(500, {}));
    const failed = renderIn(<NextClassCard />);
    await settled();
    expect(failed.container).toBeEmptyDOMElement();
  });
});
