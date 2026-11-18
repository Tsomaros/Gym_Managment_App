import type { BookingView, ClassSessionView, Membership } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, membership } from '../../test/fixtures';
import { ClassTimetablePage } from './ClassTimetablePage';
import { classSession, PILATES } from './test-data';

const NOW = new Date('2027-05-12T07:00:00Z'); // Wednesday 10:00 in Athens

describe('ClassTimetablePage (member)', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let sessions: ClassSessionView[];
  let memberships: Membership[];
  let bookings: BookingView[];

  beforeEach(() => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Athens',
    } as Intl.ResolvedDateTimeFormatOptions);
    sessions = [
      classSession({ id: 'a', date: '2027-05-12', startsAt: '18:00', booked: 9, capacity: 12 }),
      classSession({
        id: 'b',
        date: '2027-05-12',
        startsAt: '19:30',
        booked: 12,
        capacity: 12,
        type: { id: PILATES.id, name: PILATES.name, nameEn: null },
      }),
      classSession({ id: 'c', date: '2027-05-13', startsAt: '10:00', booked: 1, capacity: 12 }),
    ];
    memberships = [membership({ includesClasses: true, status: 'active' })];
    bookings = [];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/me/memberships')) return json(200, { memberships });
      if (url.includes('/me/bookings')) return json(200, bookings);
      if (init?.method === 'POST') return json(201, { id: 'bk' });
      return json(200, sessions);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderPage = (path = `/g/${GYM}/classes`) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/g/:gymId/classes/*" element={<ClassTimetablePage now={() => NOW} />} />
        </Routes>
      </MemoryRouter>,
    );

  it("asks for 14 days and shows today's classes with spots left, 'Πλήρες' for a full one", async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: '18:00 Σπινινγκ' })).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).endsWith('/class-sessions?from=2027-05-12&to=2027-05-25'),
      ),
    ).toBe(true);
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText(/3 θέσεις/)).toBeVisible();
    expect(within(cards[1]!).getByRole('button', { name: /^Πλήρες/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByText('10:00 Σπινινγκ')).not.toBeInTheDocument(); // tomorrow's
  });

  it('day tabs switch the day and mark the chosen one', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '18:00 Σπινινγκ' });
    const tomorrow = screen.getAllByRole('button', { pressed: false })[0]!;
    await userEvent.click(tomorrow);
    expect(await screen.findByRole('heading', { name: '10:00 Σπινινγκ' })).toBeVisible();
    expect(tomorrow).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: '18:00 Σπινινγκ' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('booking from a card posts and reloads the list', async () => {
    renderPage();
    const card = (await screen.findByRole('heading', { name: '18:00 Σπινινγκ' })).closest('li')!;
    const before = fetchMock.mock.calls.filter(([u]) => String(u).includes('/class-sessions?')).length;
    await userEvent.click(within(card).getByRole('button', { name: /^Κράτηση/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u]) => String(u).includes('/class-sessions?')).length,
      ).toBe(before + 1),
    );
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(String(post[0])).toBe(`/api/gyms/${GYM}/class-sessions/a/bookings`);
  });

  it('a member without classes in any membership sees the banner and disabled buttons', async () => {
    memberships = [membership({ includesClasses: false, status: 'active' })];
    renderPage();
    expect(await screen.findByText(/χρειάζεσαι συνδρομή με μαθήματα ή πακέτο/)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Χρειάζεσαι συνδρομή με μαθήματα' })[0],
      ).toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('an expired membership with classes does not count', async () => {
    memberships = [membership({ includesClasses: true, status: 'expired' })];
    renderPage();
    expect(await screen.findByText(/χρειάζεσαι συνδρομή με μαθήματα ή πακέτο/)).toBeVisible();
  });

  it('a membership with classes that starts later still lets the member book', async () => {
    memberships = [membership({ includesClasses: true, status: 'upcoming' })];
    renderPage();
    const card = (await screen.findByRole('heading', { name: '18:00 Σπινινγκ' })).closest('li')!;
    // canBook starts true, so wait until the memberships answer has been applied before judging.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/me/memberships'))).toBe(true),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(within(card).getByRole('button', { name: /^Κράτηση/ })).toBeVisible();
    expect(screen.queryByText(/χρειάζεσαι συνδρομή με μαθήματα ή πακέτο/)).not.toBeInTheDocument();
  });

  it('names the chosen day, marks days that have classes, and offers the next such day when empty', async () => {
    sessions = [...sessions, classSession({ id: 'd', date: '2027-05-17', startsAt: '08:00' })];
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Τετάρτη 12 Μαΐου', level: 3 })).toBeVisible();
    expect(screen.getByRole('button', { name: /13\/5.*έχει μαθήματα/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /14\/5/ })).not.toHaveTextContent('•');
    await userEvent.click(screen.getByRole('button', { name: /14\/5/ })); // no classes that day
    expect(await screen.findByText('Δεν υπάρχουν μαθήματα αυτή τη μέρα.')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Επόμενη μέρα με μαθήματα: Δευτέρα 17 Μαΐου' }),
    );
    expect(await screen.findByRole('heading', { name: 'Δευτέρα 17 Μαΐου', level: 3 })).toBeVisible();
    expect(screen.getByRole('heading', { name: '08:00 Σπινινγκ' })).toBeVisible();
  });

  it('after booking, the confirmation is announced and focus stays on that class card', async () => {
    renderPage();
    const heading = await screen.findByRole('heading', { name: '18:00 Σπινινγκ' });
    const card = heading.closest('li')!;
    await userEvent.click(within(card).getByRole('button', { name: /^Κράτηση/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Έγινε κράτηση: Σπινινγκ');
    await waitFor(() => expect(card).toHaveFocus());
  });

  it('a booked class shows the booked state with its cancel button', async () => {
    sessions[0] = classSession({
      id: 'a',
      date: '2027-05-12',
      startsAt: '18:00',
      myBooking: { id: 'bk', status: 'booked', usesEntry: true, late: true },
    });
    renderPage();
    const card = (await screen.findByRole('heading', { name: '18:00 Σπινινγκ' })).closest('li')!;
    expect(within(card).getByText('Κλεισμένο ✓')).toBeVisible();
    await userEvent.click(within(card).getByRole('button', { name: /^Ακύρωση/ }));
    expect(await screen.findByText(/χρεώνει μία είσοδο/)).toBeVisible();
  });

  it('says so for an empty day and offers a retry when loading fails', async () => {
    sessions = [];
    const { unmount } = renderPage();
    expect(await screen.findByText('Δεν υπάρχουν μαθήματα αυτή τη μέρα.')).toBeVisible();
    unmount();
    fetchMock.mockImplementation(async (input) =>
      String(input).includes('/me/memberships') ? json(200, { memberships }) : json(500, {}),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
  });

  it('links to the bookings page, which lives under /classes/my', async () => {
    bookings = [];
    renderPage(`/g/${GYM}/classes/my`);
    expect(await screen.findByRole('heading', { name: 'Οι κρατήσεις μου', level: 2 })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Μαθήματα' })).toHaveAttribute(
      'href',
      `/g/${GYM}/classes`,
    );
  });
});
