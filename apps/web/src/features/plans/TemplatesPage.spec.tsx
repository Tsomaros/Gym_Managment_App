import type { MeResponse, Plan, PlanSummary } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../../auth/AuthProvider';
import i18n from '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { TemplatesPage } from './TemplatesPage';

const ME = '7a7a7a7a-7777-4777-8777-777777777777';
const OTHER = '8b8b8b8b-8888-4888-8888-888888888888';
const D1 = 'd1111111-1111-4111-8111-111111111111';

const template = (
  id: string,
  title: string,
  authorId: string,
  authorName: string,
): PlanSummary => ({
  id,
  title,
  kind: 'interactive',
  status: 'draft',
  activatedAt: null,
  archivedAt: null,
  authorName,
  authorId,
});
const full = (s: PlanSummary): Plan => ({
  id: s.id,
  memberId: null,
  authorId: s.authorId,
  author: null,
  isTemplate: true,
  kind: 'interactive',
  title: s.title,
  notes: null,
  status: 'draft',
  pdfUrl: null,
  activatedAt: null,
  days: [{ id: D1, title: 'Ημέρα Α', exercises: [] }],
});

function auth(): AuthState {
  const me: MeResponse = {
    id: ME,
    email: 'me@x.gr',
    fullName: 'Εγώ',
    firstName: 'Εγώ',
    lastName: 'Ο ίδιος',
    emailVerified: true,
    locale: 'el',
    isPlatformAdmin: false,
    gyms: [{ gymId: GYM, gymName: 'Γυμναστήριο', roles: ['trainer'] }],
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

describe('TemplatesPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let templates: PlanSummary[];
  let listFails: boolean;

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    listFails = false;
    templates = [
      template('t-mine', 'Ολόκληρο σώμα', ME, 'Εγώ Ο ίδιος'),
      template('t-other', 'Πάνω σώμα', OTHER, 'Νίκος Γυμναστής'),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input).replace(`/api/gyms/${GYM}`, '');
      const method = init?.method ?? 'GET';
      if (url === '/plan-templates' && method === 'GET')
        return listFails ? json(500, {}) : json(200, templates);
      const m = /^\/plan-templates\/([^/]+)$/.exec(url);
      if (m && method === 'GET') {
        const found = templates.find((x) => x.id === m[1]);
        return found ? json(200, full(found)) : json(404, {});
      }
      if (m && method === 'DELETE') {
        templates = templates.filter((x) => x.id !== m[1]);
        return new Response(null, { status: 204 });
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <AuthContext.Provider value={auth()}>
        <MemoryRouter initialEntries={[`/g/${GYM}/plans`]}>
          <Routes>
            <Route path="/g/:gymId/plans" element={<TemplatesPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

  it("lists the gym's templates with their authors and marks the ones that are yours", async () => {
    renderPage();
    const mine = await screen.findByRole('listitem', { name: /Ολόκληρο σώμα/ });
    expect(within(mine).getByText('Δικό σου')).toBeInTheDocument();
    const other = screen.getByRole('listitem', { name: /Πάνω σώμα/ });
    expect(within(other).getByText('από Νίκος Γυμναστής')).toBeInTheDocument();
    expect(within(other).queryByText('Δικό σου')).toBeNull();
  });

  it('only the author gets edit and delete', async () => {
    renderPage();
    const mine = await screen.findByRole('listitem', { name: /Ολόκληρο σώμα/ });
    expect(
      within(mine).getByRole('button', { name: 'Επεξεργασία «Ολόκληρο σώμα»' }),
    ).toBeInTheDocument();
    expect(
      within(mine).getByRole('button', { name: 'Διαγραφή «Ολόκληρο σώμα»' }),
    ).toBeInTheDocument();
    const other = screen.getByRole('listitem', { name: /Πάνω σώμα/ });
    expect(within(other).queryByRole('button', { name: /^Επεξεργασία/ })).toBeNull();
    expect(within(other).queryByRole('button', { name: /^Διαγραφή/ })).toBeNull();
    expect(within(other).getByRole('button', { name: 'Προβολή «Πάνω σώμα»' })).toBeInTheDocument();
  });

  it('shows a template to read, from anyone', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Προβολή «Πάνω σώμα»' }));
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ημέρα Α' })).toBeInTheDocument();
  });

  it('deletes your template after a confirmation, and says so', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Διαγραφή «Ολόκληρο σώμα»' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Τα προγράμματα που φτιάχτηκαν από αυτό δεν αλλάζουν.');
    await user.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Διαγραφή «Ολόκληρο σώμα»' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Διαγραφή' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: /Ολόκληρο σώμα/ })).toBeNull(),
    );
    expect(await screen.findByText('✓ Το πρότυπο διαγράφηκε.')).toBeInTheDocument();
    const del = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
    expect(String(del[0])).toBe(`/api/gyms/${GYM}/plan-templates/t-mine`);
  });

  it('opens your template in the editor, and a new template in an empty one', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Επεξεργασία «Ολόκληρο σώμα»' }));
    expect(await screen.findByLabelText('Τίτλος προγράμματος')).toHaveValue('Ολόκληρο σώμα');
    expect(screen.queryByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    await user.click(await screen.findByRole('button', { name: 'Νέο πρότυπο' }));
    expect(await screen.findByLabelText('Τίτλος προγράμματος')).toHaveValue('');
  });

  it('says so when there are no templates, and when they cannot be loaded', async () => {
    templates = [];
    const { unmount } = renderPage();
    expect(
      await screen.findByText(
        'Δεν υπάρχουν πρότυπα ακόμα. Φτιάξε το πρώτο ή αποθήκευσε ένα πρόγραμμα ως πρότυπο.',
      ),
    ).toBeInTheDocument();
    unmount();
    listFails = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν φορτώθηκαν τα πρότυπα.');
  });
});
