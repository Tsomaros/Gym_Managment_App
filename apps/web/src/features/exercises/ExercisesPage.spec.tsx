import type { Exercise, MeResponse } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../auth/AuthProvider';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ExercisesPage } from './ExercisesPage';

const ME = '7a7a7a7a-7777-4777-8777-777777777777';
const OTHER = '8b8b8b8b-8888-4888-8888-888888888888';
const ex = (
  n: number,
  nameEl: string,
  group: Exercise['muscleGroup'],
  createdBy: string | null,
): Exercise => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  nameEl,
  nameEn: null,
  muscleGroup: group,
  measure: 'reps',
  archived: false,
  createdBy,
});
const LIST = [
  ex(1, 'Πιέσεις στήθους', 'chest', null),
  ex(2, 'Πεταλούδα', 'chest', OTHER),
  ex(3, 'Σανίδα', 'core', ME),
];

function auth(roles: MeResponse['gyms'][number]['roles']): AuthState {
  return {
    me: {
      id: ME,
      email: 'me@x.gr',
      fullName: 'Εγώ',
      firstName: 'Εγώ',
      lastName: 'Ο ίδιος',
      emailVerified: true,
      locale: 'el',
      isPlatformAdmin: false,
      gyms: [{ gymId: GYM, gymName: 'Γυμναστήριο', roles }],
    },
    status: 'ready',
    login: vi.fn(),
    logout: vi.fn(),
    startSession: vi.fn(),
    refreshMe: vi.fn(),
  };
}

describe('ExercisesPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let archivedIds: string[];

  beforeEach(() => {
    archivedIds = [];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/archive') && init?.method === 'POST') {
        archivedIds.push(url.split('/').at(-2)!);
        return new Response(null, { status: 204 });
      }
      if (url.includes('/exercises'))
        return json(
          200,
          LIST.filter((e) => !archivedIds.includes(e.id)),
        );
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = (roles: MeResponse['gyms'][number]['roles']) =>
    render(
      <AuthContext.Provider value={auth(roles)}>
        <MemoryRouter initialEntries={[`/g/${GYM}/exercises`]}>
          <Routes>
            <Route path="/g/:gymId/exercises" element={<ExercisesPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

  it('groups the exercises under their muscle group', async () => {
    renderPage(['trainer']);
    const chest = await screen.findByRole('region', { name: 'Στήθος' });
    expect(within(chest).getByText('Πιέσεις στήθους')).toBeInTheDocument();
    expect(within(chest).getByText('Πεταλούδα')).toBeInTheDocument();
    const core = screen.getByRole('region', { name: 'Κορμός' });
    expect(within(core).getByText('Σανίδα')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Πόδια' })).toBeNull(); // empty groups are not shown
  });

  it('searches through the API', async () => {
    const user = userEvent.setup();
    renderPage(['trainer']);
    await screen.findByText('Σανίδα');
    await user.type(screen.getByRole('searchbox', { name: 'Αναζήτηση' }), 'πιεσ');
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(([u]) => decodeURIComponent(String(u)).includes('q=πιεσ')),
        ).toBe(true),
      { timeout: 2000 },
    );
  });

  it('offers archive only for the creator, or for the owner on every exercise', async () => {
    const { unmount } = renderPage(['trainer']);
    await screen.findByText('Σανίδα');
    // Trainer: only the exercise they created (Σανίδα).
    expect(screen.getAllByRole('button', { name: /^Αρχειοθέτηση/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Αρχειοθέτηση «Σανίδα»' })).toBeInTheDocument();
    // Everybody can edit.
    expect(screen.getAllByRole('button', { name: /^Επεξεργασία/ })).toHaveLength(3);
    unmount();
    renderPage(['owner']);
    await screen.findByText('Σανίδα');
    expect(screen.getAllByRole('button', { name: /^Αρχειοθέτηση/ })).toHaveLength(3);
  });

  it('does not let an owner of another gym archive here', async () => {
    const OTHER_GYM = '9c9c9c9c-9999-4999-8999-999999999999';
    const state = auth(['trainer']);
    state.me!.gyms = [
      { gymId: OTHER_GYM, gymName: 'Άλλο', roles: ['owner'] },
      { gymId: GYM, gymName: 'Γυμναστήριο', roles: ['trainer'] },
    ];
    render(
      <AuthContext.Provider value={state}>
        <MemoryRouter initialEntries={[`/g/${GYM}/exercises`]}>
          <Routes>
            <Route path="/g/:gymId/exercises" element={<ExercisesPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    await screen.findByText('Σανίδα');
    expect(screen.getAllByRole('button', { name: /^Αρχειοθέτηση/ })).toHaveLength(1);
  });

  it('never asks for archived exercises', async () => {
    renderPage(['owner']);
    await screen.findByText('Σανίδα');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('includeArchived'))).toBe(true);
  });

  it('archives after a confirmation and takes the exercise off the list', async () => {
    const user = userEvent.setup();
    renderPage(['trainer']);
    await user.click(await screen.findByRole('button', { name: 'Αρχειοθέτηση «Σανίδα»' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Σανίδα');
    await user.click(within(dialog).getByRole('button', { name: 'Αρχειοθέτηση' }));
    await waitFor(() => expect(screen.queryByText('Σανίδα')).toBeNull());
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/archive'))!;
    expect(String(call[0])).toBe(`/api/gyms/${GYM}/exercises/${LIST[2]!.id}/archive`);
    expect(call[1]?.method).toBe('POST');
  });

  it('confirms the archive in a message and moves focus to the search box', async () => {
    const user = userEvent.setup();
    renderPage(['trainer']);
    await user.click(await screen.findByRole('button', { name: 'Αρχειοθέτηση «Σανίδα»' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Αρχειοθέτηση' }),
    );
    expect(await screen.findByText('✓ Η άσκηση «Σανίδα» αρχειοθετήθηκε.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Αναζήτηση' })).toHaveFocus());
  });

  it('limits the search box to what the API accepts', async () => {
    renderPage(['trainer']);
    expect(await screen.findByRole('searchbox', { name: 'Αναζήτηση' })).toHaveAttribute(
      'maxlength',
      '80',
    );
  });

  it('cancelling the confirmation archives nothing', async () => {
    const user = userEvent.setup();
    renderPage(['trainer']);
    await user.click(await screen.findByRole('button', { name: 'Αρχειοθέτηση «Σανίδα»' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Άκυρο' }),
    );
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/archive'))).toBe(false);
    expect(screen.getByText('Σανίδα')).toBeInTheDocument();
  });

  it('opens the add form and shows the new exercise after saving', async () => {
    const user = userEvent.setup();
    renderPage(['trainer']);
    await screen.findByText('Σανίδα');
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'POST') return json(201, ex(4, 'Νέα κίνηση', 'legs', ME));
      return json(200, [...LIST, ex(4, 'Νέα κίνηση', 'legs', ME)]);
    });
    await user.click(screen.getByRole('button', { name: 'Νέα άσκηση' }));
    await user.type(await screen.findByLabelText('Όνομα (ελληνικά)'), 'Νέα κίνηση');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Νέα κίνηση')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when the library cannot be loaded, and retries', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    const user = userEvent.setup();
    renderPage(['trainer']);
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    await user.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByText('Σανίδα')).toBeInTheDocument();
  });
});
