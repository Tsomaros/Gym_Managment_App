import type { MeResponse } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../auth/AuthProvider';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { MyClassesPage } from './MyClassesPage';
import { attendee, classSession, TRAINER } from './test-data';

const NOW = new Date('2027-05-12T07:00:00Z'); // Wednesday 10:00 in Athens
const ME = TRAINER.userId;

function auth(): AuthState {
  const me: MeResponse = {
    id: ME,
    email: 't@x.gr',
    fullName: 'Νίκος Γυμναστής',
    firstName: 'Νίκος',
    lastName: 'Γυμναστής',
    emailVerified: true,
    locale: 'el',
    isPlatformAdmin: false,
    gyms: [{ gymId: GYM, gymName: 'Gym', roles: ['trainer'] }],
  };
  return {
    me,
    status: 'ready',
    login: vi.fn(),
    logout: vi.fn(),
    startSession: vi.fn(),
    refreshMe: vi.fn(),
  };
}

describe('MyClassesPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Athens',
    } as Intl.ResolvedDateTimeFormatOptions);
    const sessions = [
      classSession({ id: 'mine-today', date: '2027-05-12', startsAt: '18:00' }),
      classSession({
        id: 'other-today',
        date: '2027-05-12',
        startsAt: '19:00',
        trainer: { id: 'someone-else', firstName: 'Άλλος' },
      }),
      classSession({ id: 'mine-later', date: '2027-05-14', startsAt: '09:00' }),
      classSession({ id: 'no-trainer', date: '2027-05-13', startsAt: '09:00', trainer: null }),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/attendees')) return json(200, [attendee({ id: 'b1' })]);
      if (init?.method === 'POST') return new Response(null, { status: 204 });
      return json(200, sessions);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderPage = () =>
    render(
      <AuthContext.Provider value={auth()}>
        <MemoryRouter initialEntries={[`/g/${GYM}/classes`]}>
          <Routes>
            <Route path="/g/:gymId/classes" element={<MyClassesPage now={() => NOW} />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

  it('asks for today and the next 7 days and lists only the classes this trainer runs', async () => {
    renderPage();
    await screen.findByText(/18:00/);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toBe(`/api/gyms/${GYM}/class-sessions?from=2027-05-12&to=2027-05-19`);
    expect(screen.getByText(/09:00/)).toBeVisible(); // the later one of mine
    expect(screen.queryByText(/19:00/)).not.toBeInTheDocument(); // somebody else's
    expect(screen.getAllByRole('listitem')).toHaveLength(2); // the one without a trainer is not mine either
  });

  it("today's class opens straight into attendance, where ticking works and owner actions are absent", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /18:00/ }));
    expect(await screen.findByText('Μαρία Νικολάου')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ακύρωση μαθήματος' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Κράτηση για μέλος')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Παρών: Μαρία Νικολάου' }));
    await waitFor(() => expect(screen.getByTestId('chip-b1')).toHaveTextContent('Παρών'));
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(String(post[0])).toBe(`/api/gyms/${GYM}/bookings/b1/attendance`);
  });

  it('a class on a later day is listed but cannot be opened for attendance yet', async () => {
    renderPage();
    const later = (await screen.findByText(/09:00/)).closest('li')!;
    expect(within(later).queryByRole('button')).not.toBeInTheDocument();
  });

  it('after Back the class row has focus again, and a later reload does not steal it', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /18:00/ }));
    await screen.findByText('Μαρία Νικολάου');
    await userEvent.click(screen.getByRole('button', { name: /Πρόγραμμα|Πίσω/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /18:00/ })).toHaveFocus());
    screen.getByRole('button', { name: /18:00/ }).blur();
    await userEvent.click(document.body);
    expect(screen.getByRole('button', { name: /18:00/ })).not.toHaveFocus();
  });

  it('says so when the trainer has no classes, and offers a retry when loading fails', async () => {
    fetchMock.mockImplementation(async () => json(200, []));
    const { unmount } = renderPage();
    expect(await screen.findByText(/δεν έχεις μαθήματα/i)).toBeVisible();
    unmount();
    fetchMock.mockImplementation(async () => json(500, {}));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν φορτώθηκαν τα μαθήματά σου');
  });
});
