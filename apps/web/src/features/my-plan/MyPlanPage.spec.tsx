import type { Membership, Plan, PlanSummary } from '@gym/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, membership } from '../../test/fixtures';
import { MyPlanPage } from './MyPlanPage';

const D1 = 'd1111111-1111-4111-8111-111111111111';
const D2 = 'd2222222-2222-4222-8222-222222222222';
const X1 = '00000000-0000-4000-8000-000000000001';
const X2 = '00000000-0000-4000-8000-000000000002';
const X3 = '00000000-0000-4000-8000-000000000003';

const ex = (
  id: string,
  exerciseId: string,
  nameEl: string,
  nameEn: string | null,
  over: Partial<Plan['days'][0]['exercises'][0]> = {},
) => ({
  id,
  exerciseId,
  exercise: {
    nameEl,
    nameEn,
    muscleGroup: 'chest' as const,
    measure: 'weight_reps' as const,
    archived: false,
  },
  sets: 4,
  repsMin: 8,
  repsMax: 10,
  toFailure: false,
  weightKg: 50,
  restSeconds: 90,
  durationSeconds: null,
  notes: null,
  ...over,
});

const ACTIVE: Plan = {
  id: 'p-active',
  memberId: 'm1',
  authorId: 't1',
  author: { firstName: 'Νίκος', lastName: 'Γυμναστής' },
  isTemplate: false,
  kind: 'interactive',
  title: 'Πάνω σώμα',
  notes: null,
  status: 'active',
  pdfUrl: null,
  activatedAt: '2027-05-12T09:00:00.000Z',
  days: [
    {
      id: D1,
      title: 'Ημέρα Α – Στήθος',
      exercises: [
        ex('e1', X1, 'Πιέσεις στήθους', 'Bench press'),
        ex('e2', X2, 'Έλξεις', null, {
          toFailure: true,
          repsMin: null,
          repsMax: null,
          weightKg: null,
          restSeconds: null,
        }),
        ex('e3', X3, 'Κάμψεις δικεφάλων', 'Biceps curl', {
          sets: 3,
          repsMin: 12,
          repsMax: 12,
          weightKg: 14,
        }),
      ],
    },
    { id: D2, title: 'Ημέρα Β – Πόδια', exercises: [] },
  ],
};
const OLD: Plan = { ...ACTIVE, id: 'p-old', title: 'Παλιό πρόγραμμα', status: 'archived' };
const summary = (p: Plan): PlanSummary => ({
  id: p.id,
  title: p.title,
  kind: p.kind,
  status: p.status,
  activatedAt: p.activatedAt,
  archivedAt: p.status === 'archived' ? '2027-04-30T00:00:00.000Z' : null,
  authorName: 'Νίκος Γυμναστής',
  authorId: 't1',
});

describe('MyPlanPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let plans: Plan[];
  let memberships: Membership[];
  let status: { active: number; list: number };

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    plans = [ACTIVE, OLD];
    memberships = [membership({ includesTrainer: true })];
    status = { active: 200, list: 200 };
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input).replace(`/api/gyms/${GYM}`, '');
      if (url === '/me/memberships') return json(200, { memberships });
      if (url === '/me/plans')
        return status.list === 200 ? json(200, plans.map(summary)) : json(status.list, {});
      if (url === '/me/plans/active') {
        const active = plans.find((p) => p.status === 'active');
        if (status.active !== 200) return json(status.active, {});
        return active ? json(200, active) : json(404, {});
      }
      const m = /^\/plans\/([^/]+)$/.exec(url);
      const found = m && plans.find((p) => p.id === m[1]);
      return found ? json(200, found) : json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage('el');
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/myWorkouts`]}>
        <Routes>
          <Route path="/g/:gymId/myWorkouts" element={<MyPlanPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the active plan day by day as tabs, the first day open', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Το πρόγραμμά μου' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Ημέρα Α – Στήθος', 'Ημέρα Β – Πόδια']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.setup().click(tabs[1]!);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Χωρίς ασκήσεις.');
  });

  it('writes each target the way a trainer would: a range, a single number, "max"', async () => {
    renderPage();
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getByText('4 × 8–10 @ 50 kg')).toBeInTheDocument();
    expect(within(panel).getByText('4 × max')).toBeInTheDocument();
    expect(within(panel).getByText('3 × 12 @ 14 kg')).toBeInTheDocument();
    // Two of the three exercises rest 90 seconds; "max" has no rest set.
    expect(within(panel).getAllByText('ανάπαυση 90″')).toHaveLength(2);
  });

  it('shows exercise names in English for an English member, falling back to Greek', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getByText('Bench press')).toBeInTheDocument();
    expect(within(panel).getByText('Biceps curl')).toBeInTheDocument();
    expect(within(panel).getByText('Έλξεις')).toBeInTheDocument(); // no English name
    expect(within(panel).getByText('4 × 8–10 @ 50 kg')).toBeInTheDocument();
    // The Greek name must not leak next to the English one.
    expect(within(panel).queryByText('Πιέσεις στήθους')).toBeNull();
    expect(within(panel).queryByText('Κάμψεις δικεφάλων')).toBeNull();
  });

  it('a PDF plan has a big button that opens the signed link in a new tab, and a download', async () => {
    plans = [
      {
        ...ACTIVE,
        kind: 'pdf',
        days: [],
        title: 'Πρόγραμμα PDF',
        pdfUrl: 'https://files.example/plan.pdf?X-Amz-Signature=abc&X-Amz-Expires=300',
      },
    ];
    renderPage();
    const open = await screen.findByRole('link', { name: 'Άνοιγμα PDF' });
    expect(open).toHaveAttribute('href', plans[0]!.pdfUrl);
    expect(open).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Λήψη' })).toHaveAttribute('download');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('tells a member with a trainer to talk to the trainer when there is no plan yet', async () => {
    plans = [];
    renderPage();
    expect(
      await screen.findByText('Δεν έχεις ακόμη πρόγραμμα — μίλησε με τον γυμναστή σου.'),
    ).toBeInTheDocument();
  });

  it('tells a member without a trainer to ask at reception', async () => {
    plans = [];
    memberships = [membership({ includesTrainer: false })];
    renderPage();
    expect(
      await screen.findByText('Δεν έχεις ακόμη πρόγραμμα — ρώτα στην υποδοχή.'),
    ).toBeInTheDocument();
  });

  it.each(['expired', 'voided', 'used_up'] as const)(
    'a %s trainer membership counts as having no trainer',
    async (status) => {
      plans = [];
      memberships = [membership({ includesTrainer: true, status })];
      renderPage();
      expect(
        await screen.findByText('Δεν έχεις ακόμη πρόγραμμα — ρώτα στην υποδοχή.'),
      ).toBeInTheDocument();
    },
  );

  it.each(['active', 'frozen', 'upcoming'] as const)(
    'a %s trainer membership counts as having a trainer',
    async (status) => {
      plans = [];
      memberships = [membership({ includesTrainer: true, status })];
      renderPage();
      expect(
        await screen.findByText('Δεν έχεις ακόμη πρόγραμμα — μίλησε με τον γυμναστή σου.'),
      ).toBeInTheDocument();
    },
  );

  it('a trainer membership among several is enough, even beside one without a trainer', async () => {
    plans = [];
    memberships = [
      membership({ includesTrainer: false, status: 'active' }),
      membership({ id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f61', includesTrainer: true }),
    ];
    renderPage();
    expect(
      await screen.findByText('Δεν έχεις ακόμη πρόγραμμα — μίλησε με τον γυμναστή σου.'),
    ).toBeInTheDocument();
  });

  it('lists older plans under a collapsed heading and opens one to read', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    const older = screen.getByText('Προηγούμενα προγράμματα').closest('details')!;
    expect(older).not.toHaveAttribute('open');
    await user.click(screen.getByText('Προηγούμενα προγράμματα'));
    expect(older).toHaveAttribute('open');
    await user.click(within(older).getByRole('button', { name: 'Προβολή «Παλιό πρόγραμμα»' }));
    expect(await screen.findByRole('heading', { name: 'Παλιό πρόγραμμα' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Πάνω σώμα' })).toBeNull();
    // And back to the current one.
    await user.click(screen.getByRole('button', { name: 'Πίσω στο τρέχον πρόγραμμα' }));
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
  });

  it('has no older-plans section when there are none, and no log button yet', async () => {
    plans = [ACTIVE];
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    expect(screen.queryByText('Προηγούμενα προγράμματα')).toBeNull();
    expect(screen.queryByRole('button', { name: /Καταγραφή/ })).toBeNull();
  });

  it('a failed attempt to open an older plan retries that plan, and the alert goes away after a success', async () => {
    let oldFails = true;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      oldFails && String(input).endsWith('/plans/p-old') ? json(500, {}) : base(input, init),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    await user.click(screen.getByText('Προηγούμενα προγράμματα'));
    await user.click(screen.getByRole('button', { name: 'Προβολή «Παλιό πρόγραμμα»' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.getByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
    oldFails = false;
    await user.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Παλιό πρόγραμμα' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('moves focus to the way back when an older plan opens, so the change is announced and in reach', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Πάνω σώμα' });
    await user.click(screen.getByText('Προηγούμενα προγράμματα'));
    await user.click(screen.getByRole('button', { name: 'Προβολή «Παλιό πρόγραμμα»' }));
    const back = await screen.findByRole('button', { name: 'Πίσω στο τρέχον πρόγραμμα' });
    await vi.waitFor(() => expect(back).toHaveFocus());
  });

  it('still shows the active plan when the older plans or the memberships cannot be loaded', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      /\/me\/(plans|memberships)$/.test(String(input)) ? json(500, {}) : base(input, init),
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Προηγούμενα προγράμματα')).toBeNull();
  });

  it('gets a fresh signed PDF link when the page comes back after more than four minutes', async () => {
    const withUrl = (url: string): Plan => ({
      ...ACTIVE,
      kind: 'pdf',
      days: [],
      title: 'Πρόγραμμα PDF',
      pdfUrl: url,
    });
    plans = [withUrl('https://files.example/plan.pdf?X-Amz-Signature=first')];
    renderPage();
    const link = await screen.findByRole('link', { name: 'Άνοιγμα PDF' });
    expect(link).toHaveAttribute('href', expect.stringContaining('first'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const realNow = Date.now();
    const now = vi.spyOn(Date, 'now');

    // Back after two minutes: the link is still good, nothing is fetched.
    now.mockReturnValue(realNow + 2 * 60_000);
    const callsBefore = fetchMock.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    // Back after six minutes: the link has expired, so it is signed again.
    plans = [withUrl('https://files.example/plan.pdf?X-Amz-Signature=second')];
    now.mockReturnValue(realNow + 6 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() =>
      expect(screen.getByRole('link', { name: 'Άνοιγμα PDF' })).toHaveAttribute(
        'href',
        expect.stringContaining('second'),
      ),
    );
    now.mockRestore();
    visibility.mockRestore();
  });

  it('keeps showing the plan, without an error, when that quiet refresh fails', async () => {
    plans = [
      {
        ...ACTIVE,
        kind: 'pdf',
        days: [],
        title: 'Πρόγραμμα PDF',
        pdfUrl: 'https://files.example/plan.pdf?X-Amz-Signature=first',
      },
    ];
    renderPage();
    await screen.findByRole('link', { name: 'Άνοιγμα PDF' });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    status.active = 500;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('link', { name: 'Άνοιγμα PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    now.mockRestore();
    visibility.mockRestore();
  });

  it('shows only the older plans when nothing is active', async () => {
    plans = [OLD];
    renderPage();
    expect(
      await screen.findByText('Δεν έχεις ακόμη πρόγραμμα — μίλησε με τον γυμναστή σου.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Προηγούμενα προγράμματα')).toBeInTheDocument();
  });

  it('says so when the plan cannot be loaded, and retries', async () => {
    status.active = 500;
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(screen.queryByText(/Δεν έχεις ακόμη πρόγραμμα/)).toBeNull();
    status.active = 200;
    await user.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
  });
});
