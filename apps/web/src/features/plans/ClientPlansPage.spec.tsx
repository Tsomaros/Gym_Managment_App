import type { Plan, PlanSummary, TrainerClient } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { ClientPlansPage } from './ClientPlansPage';

const client = (over: Partial<TrainerClient> = {}): TrainerClient => ({
  memberId: MEMBER,
  firstName: 'Μαρία',
  lastName: 'Μέλος',
  photoUrl: null,
  paused: false,
  membershipStatus: 'active',
  assignedAt: '2027-05-01T00:00:00.000Z',
  ...over,
});

const D1 = 'd1111111-1111-4111-8111-111111111111';
const E1 = 'e1111111-1111-4111-8111-111111111111';
const X1 = '00000000-0000-4000-8000-000000000001';
const plan = (
  id: string,
  title: string,
  status: Plan['status'],
  over: Partial<Plan> = {},
): Plan => ({
  id,
  memberId: MEMBER,
  authorId: 't1',
  author: { firstName: 'Νίκος', lastName: 'Γυμναστής' },
  isTemplate: false,
  kind: 'interactive',
  title,
  notes: null,
  status,
  pdfUrl: null,
  activatedAt: status === 'draft' ? null : '2027-05-12T09:00:00.000Z',
  days: [
    {
      id: D1,
      title: 'Ημέρα Α',
      exercises: [
        {
          id: E1,
          exerciseId: X1,
          exercise: {
            nameEl: 'Πιέσεις στήθους',
            nameEn: 'Bench press',
            muscleGroup: 'chest',
            measure: 'weight_reps',
            archived: false,
          },
          sets: 4,
          repsMin: 8,
          repsMax: 10,
          toFailure: false,
          weightKg: 50,
          restSeconds: null,
          durationSeconds: null,
          notes: null,
        },
      ],
    },
  ],
  ...over,
});
const summary = (p: Plan): PlanSummary => ({
  id: p.id,
  title: p.title,
  kind: p.kind,
  status: p.status,
  activatedAt: p.activatedAt,
  archivedAt: p.status === 'archived' ? '2027-06-01T00:00:00.000Z' : null,
  authorName: 'Νίκος Γυμναστής',
  authorId: 't1',
});

describe('ClientPlansPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let plans: Plan[];
  let clients: TrainerClient[];
  let listStatus: number;

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    listStatus = 200;
    clients = [client()];
    plans = [
      plan('p-active', 'Πάνω σώμα', 'active'),
      plan('p-draft', 'Πρόχειρο', 'draft'),
      plan('p-old', 'Παλιό πρόγραμμα', 'archived'),
    ];
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input).replace(`/api/gyms/${GYM}`, '');
      const method = init?.method ?? 'GET';
      if (url === '/trainer/clients') return json(200, clients);
      if (url === `/members/${MEMBER}/plans` && method === 'GET')
        return listStatus === 200 ? json(200, plans.map(summary)) : json(listStatus, {});
      const m = /^\/plans\/([^/]+)(\/activate|\/archive)?$/.exec(url);
      if (m) {
        const found = plans.find((p) => p.id === m[1]);
        if (!found) return json(404, {});
        if (m[2] === '/activate' && method === 'POST') {
          plans = plans.map((p) =>
            p.id === found.id
              ? { ...p, status: 'active' as const }
              : p.status === 'active'
                ? { ...p, status: 'archived' as const }
                : p,
          );
          return json(200, { ...found, status: 'active' });
        }
        if (m[2] === '/archive' && method === 'POST') {
          plans = plans.map((p) => (p.id === found.id ? { ...p, status: 'archived' as const } : p));
          return new Response(null, { status: 204 });
        }
        if (method === 'GET') return json(200, found);
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/members/${MEMBER}/plans`]}>
        <Routes>
          <Route path="/g/:gymId/members/:memberId/plans" element={<ClientPlansPage />} />
          <Route path="/g/:gymId/members" element={<p>Λίστα πελατών</p>} />
        </Routes>
      </MemoryRouter>,
    );
  const posts = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url]) => String(url).replace(`/api/gyms/${GYM}`, ''));

  it("shows the client's name, the active plan, and the other plans as a history", async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Προγράμματα: Μαρία Μέλος' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
    expect(screen.getByText('4 × 8–10 @ 50 kg')).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'Ιστορικό' });
    expect(within(history).getByText('Πρόχειρο')).toBeInTheDocument();
    expect(within(history).getByText('Παλιό πρόγραμμα')).toBeInTheDocument();
    expect(within(history).queryByText('Πάνω σώμα')).toBeNull(); // the active one is above
  });

  it('a primary trainer can edit, start a new plan, and sees no read-only banner', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    expect(screen.getByRole('button', { name: 'Επεξεργασία' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Νέο πρόγραμμα' })).toBeInTheDocument();
    expect(screen.queryByText('Αντικατάσταση σήμερα — μόνο ανάγνωση')).toBeNull();
  });

  it('a cover trainer sees a read-only banner and no way to change anything', async () => {
    clients = [client({ cover: true })];
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    expect(screen.getByText('Αντικατάσταση σήμερα — μόνο ανάγνωση')).toBeInTheDocument();
    for (const name of ['Επεξεργασία', 'Νέο πρόγραμμα', 'Ενεργοποίηση', 'Αρχειοθέτηση']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull();
    }
    // Reading the history still works.
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Προβολή «Παλιό πρόγραμμα»' }));
    expect(await screen.findByRole('heading', { name: 'Παλιό πρόγραμμα' })).toBeInTheDocument();
  });

  it('says the plan could not be loaded, with a retry, instead of "no active plan"', async () => {
    let failPlan = true;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      failPlan && String(input).endsWith('/plans/p-active') ? json(500, {}) : base(input, init),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν φορτώθηκαν τα προγράμματα.');
    expect(screen.queryByText('Δεν υπάρχει ενεργό πρόγραμμα.')).toBeNull();
    failPlan = false;
    await user.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
  });

  it('does not quietly turn read-only when the client list cannot be loaded', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith('/trainer/clients') ? json(500, {}) : base(input, init),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν φορτώθηκαν τα προγράμματα.');
    expect(screen.queryByRole('button', { name: 'Νέο πρόγραμμα' })).toBeNull();
  });

  it('a slow answer for the first plan never replaces the plan the trainer opened meanwhile', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/plans/p-active')) await gate;
      return base(input, init);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Προβολή «Παλιό πρόγραμμα»' }));
    expect(await screen.findByRole('heading', { name: 'Παλιό πρόγραμμα' })).toBeInTheDocument();
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('heading', { name: 'Παλιό πρόγραμμα' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Πάνω σώμα' })).toBeNull();
  });

  it('says so when the trainer has no access to this member (404)', async () => {
    listStatus = 404;
    renderPage();
    expect(
      await screen.findByText('Δεν έχεις πρόσβαση στα προγράμματα αυτού του μέλους.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Νέο πρόγραμμα' })).toBeNull();
  });

  it('says there is no active plan, and still offers a new one', async () => {
    plans = [plan('p-old', 'Παλιό πρόγραμμα', 'archived')];
    renderPage();
    expect(await screen.findByText('Δεν υπάρχει ενεργό πρόγραμμα.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Νέο πρόγραμμα' })).toBeInTheDocument();
  });

  it('opens a plan from the history to read it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    await user.click(screen.getByRole('button', { name: 'Προβολή «Παλιό πρόγραμμα»' }));
    expect(await screen.findByRole('heading', { name: 'Παλιό πρόγραμμα' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Πάνω σώμα' })).toBeNull();
  });

  it('Edit opens the editor on that plan; closing it unchanged returns to the page', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    await user.click(screen.getByRole('button', { name: 'Επεξεργασία' }));
    expect(await screen.findByLabelText('Τίτλος προγράμματος')).toHaveValue('Πάνω σώμα');
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Τίτλος προγράμματος')).toBeNull();
  });

  it('New plan → blank opens an empty editor', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    await user.click(screen.getByRole('button', { name: 'Νέο πρόγραμμα' }));
    await user.click(await screen.findByRole('button', { name: /Κενό πρόγραμμα/ }));
    expect(await screen.findByLabelText('Τίτλος προγράμματος')).toHaveValue('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('activates a draft, then shows it as the active plan', async () => {
    const user = userEvent.setup();
    renderPage();
    const history = await screen.findByRole('region', { name: 'Ιστορικό' });
    await user.click(within(history).getByRole('button', { name: 'Ενεργοποίηση «Πρόχειρο»' }));
    await waitFor(() => expect(posts()).toContain('/plans/p-draft/activate'));
    expect(await screen.findByRole('heading', { name: 'Πρόχειρο' })).toBeInTheDocument();
    expect(await screen.findByText('✓ Το πρόγραμμα ενεργοποιήθηκε.')).toBeInTheDocument();
  });

  it('archives the active plan only after a confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    await user.click(screen.getByRole('button', { name: 'Αρχειοθέτηση «Πάνω σώμα»' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    expect(posts()).not.toContain('/plans/p-active/archive');
    await user.click(screen.getByRole('button', { name: 'Αρχειοθέτηση «Πάνω σώμα»' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Αρχειοθέτηση' }),
    );
    await waitFor(() => expect(posts()).toContain('/plans/p-active/archive'));
    expect(await screen.findByText('Δεν υπάρχει ενεργό πρόγραμμα.')).toBeInTheDocument();
  });

  it('a PDF plan is shown with its open button and cannot be opened in the editor', async () => {
    plans = [
      plan('p-pdf', 'Πρόγραμμα PDF', 'active', {
        kind: 'pdf',
        days: [],
        pdfUrl: 'https://f.example/a.pdf?X-Amz=1',
      }),
    ];
    renderPage();
    expect(await screen.findByRole('link', { name: 'Άνοιγμα PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Επεξεργασία' })).toBeNull();
  });

  it('links back to the client list', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Πίσω στους πελάτες' })).toHaveAttribute(
      'href',
      `/g/${GYM}/members`,
    );
  });
});
