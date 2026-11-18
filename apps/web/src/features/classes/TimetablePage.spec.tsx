import type { ClassSessionView } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { classSession, SPINNING, TRAINER } from './test-data';
import { TimetablePage } from './TimetablePage';

// 2027-05-12 is a Wednesday; the week runs Monday 05-10 to Sunday 05-16.
const NOW = new Date('2027-05-12T09:00:00Z');

describe('TimetablePage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let sessions: ClassSessionView[];

  beforeEach(() => {
    sessions = [
      classSession({ id: 'a', date: '2027-05-10', startsAt: '07:00', booked: 4, capacity: 12 }),
      classSession({ id: 'b', date: '2027-05-12', startsAt: '18:00', booked: 12, capacity: 12 }),
      classSession({
        id: 'c',
        date: '2027-05-14',
        startsAt: '10:00',
        cancelled: true,
        trainer: null,
        seriesId: 's1',
      }),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/class-sessions?')) return json(200, sessions);
      if (url.includes('/class-types')) return json(200, [SPINNING]);
      if (url.includes('/schedule?')) return json(200, { shifts: [], staff: [TRAINER] });
      if (url.includes('/attendees')) return json(200, []);
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = (isOwner: boolean) =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/classes`]}>
        <Routes>
          <Route
            path="/g/:gymId/classes"
            element={<TimetablePage isOwner={isOwner} now={() => NOW} />}
          />
        </Routes>
      </MemoryRouter>,
    );

  it('asks for the week from Monday to Sunday and shows booked/capacity on each block', async () => {
    renderPage(false);
    expect(await screen.findByRole('button', { name: /Σπινινγκ 07:00, 4\/12 θέσεις/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Σπινινγκ 18:00, 12\/12 θέσεις/ })).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).endsWith('/class-sessions?from=2027-05-10&to=2027-05-16'),
      ),
    ).toBe(true);
  });

  it('strikes a cancelled class through and says so in its name', async () => {
    renderPage(false);
    const cancelled = await screen.findByRole('button', { name: /Σπινινγκ 10:00.*ακυρώθηκε/ });
    expect(within(cancelled).getByText('10:00 Σπινινγκ')).toHaveClass('line-through');
    expect(within(cancelled).getByText(/χωρίς γυμναστή/)).toBeInTheDocument();
  });

  it('only the owner can add classes', async () => {
    const { unmount } = renderPage(true);
    expect(await screen.findByRole('button', { name: 'Νέο εβδομαδιαίο μάθημα' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Νέο έκτακτο μάθημα' })).toBeVisible();
    unmount();
    renderPage(false);
    await screen.findByRole('button', { name: /Σπινινγκ 07:00/ });
    expect(screen.queryByRole('button', { name: 'Νέο εβδομαδιαίο μάθημα' })).not.toBeInTheDocument();
  });

  it('moves a week back and reloads', async () => {
    renderPage(false);
    await screen.findByRole('button', { name: /Σπινινγκ 07:00/ });
    await userEvent.click(screen.getByRole('button', { name: 'Προηγούμενη εβδομάδα' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).endsWith('/class-sessions?from=2027-05-03&to=2027-05-09'),
        ),
      ).toBe(true),
    );
  });

  it('opens a class on click and comes back to the week', async () => {
    renderPage(true);
    await userEvent.click(await screen.findByRole('button', { name: /Σπινινγκ 18:00/ }));
    expect(await screen.findByRole('heading', { name: 'Σπινινγκ', level: 2 })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Πρόγραμμα/ }));
    expect(await screen.findByRole('heading', { name: 'Πρόγραμμα μαθημάτων' })).toBeVisible();
  });

  it('says so when the week has no classes, and offers a retry when loading fails', async () => {
    sessions = [];
    const { unmount } = renderPage(false);
    expect(await screen.findByText('Δεν υπάρχουν μαθήματα αυτή την εβδομάδα.')).toBeVisible();
    unmount();
    fetchMock.mockImplementation(async () => json(500, {}));
    renderPage(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.getByRole('button', { name: 'Δοκίμασε ξανά' })).toBeVisible();
  });
});
