import type { Exercise, LastPerformance, Plan, WorkoutSession } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { FreeWorkoutPage, WorkoutPage } from './WorkoutPage';
import { QUEUE_KEY, resetQueueForTests, size } from './workoutQueue';

const X1 = '00000000-0000-4000-8000-000000000001';
const X2 = '00000000-0000-4000-8000-000000000002';
const D1 = 'd1111111-1111-4111-8111-111111111111';

const planExercise = (
  id: string,
  exerciseId: string,
  nameEl: string,
  nameEn: string | null,
  over: Partial<Plan['days'][0]['exercises'][0]> = {},
): Plan['days'][0]['exercises'][0] => ({
  id,
  exerciseId,
  exercise: { nameEl, nameEn, muscleGroup: 'chest', measure: 'weight_reps', archived: false },
  sets: 2,
  repsMin: 8,
  repsMax: 10,
  toFailure: false,
  weightKg: 50,
  restSeconds: 90,
  durationSeconds: null,
  notes: null,
  ...over,
});

const DAY: Plan['days'][0] = {
  id: D1,
  title: 'Ημέρα Α',
  exercises: [
    planExercise('pe1', X1, 'Πιέσεις στήθους', 'Bench press'),
    planExercise('pe2', X2, 'Έλξεις', null, {
      toFailure: true,
      repsMin: null,
      repsMax: null,
      weightKg: null,
      restSeconds: null,
      sets: 1,
    }),
  ],
};
const PLAN = { id: 'plan-1', days: [DAY] } as unknown as Plan;

const LAST: LastPerformance[] = [
  {
    exerciseId: X1,
    sessionDate: '2027-05-10',
    sets: [
      { reps: 10, weightKg: 52.5, durationSeconds: null },
      { reps: 9, weightKg: 52.5, durationSeconds: null },
    ],
  },
];

const LIBRARY: Exercise[] = [
  {
    id: X1,
    nameEl: 'Πιέσεις στήθους',
    nameEn: 'Bench press',
    muscleGroup: 'chest',
    measure: 'weight_reps',
    archived: false,
    createdBy: null,
  },
  {
    id: X2,
    nameEl: 'Σανίδα',
    nameEn: 'Plank',
    muscleGroup: 'core',
    measure: 'duration',
    archived: false,
    createdBy: null,
  },
];

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

describe('WorkoutPage', () => {
  let calls: Call[];
  let network: 'up' | 'down';
  let sessions: WorkoutSession[];
  const putSets = () => calls.filter((c) => c.method === 'PUT' && c.path.includes('/sets/'));

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    localStorage.clear();
    resetQueueForTests();
    calls = [];
    network = 'up';
    sessions = [];
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input).replace(`/api/gyms/${GYM}`, '');
        const method = init?.method ?? 'GET';
        if (network === 'down') throw new TypeError('Failed to fetch');
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ method, path, body });
        if (method === 'GET' && path.startsWith('/me/last-performance')) return json(200, LAST);
        if (method === 'GET' && path.startsWith('/me/sessions')) return json(200, sessions);
        if (method === 'GET' && path.startsWith('/exercises')) {
          const q = new URL(path, 'http://x').searchParams.get('q');
          return json(
            200,
            LIBRARY.filter((e) => !q || e.nameEl.includes(q)),
          );
        }
        return method === 'POST' && path.endsWith('/finish') ? json(200, {}) : json(200, {});
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderDay = (onExit = vi.fn()) =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/myWorkouts`]}>
        <Routes>
          <Route
            path="/g/:gymId/*"
            element={<WorkoutPage plan={PLAN} day={DAY} onExit={onExit} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  const card = async (name: string) => within(await screen.findByRole('region', { name }));

  it('shows each exercise with its plan target, what was lifted last time and one row per set', async () => {
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    expect(bench.getByText('2 × 8–10 @ 50 kg')).toBeInTheDocument();
    expect(bench.getByText('Την προηγούμενη φορά: 52,5×10, 52,5×9')).toBeInTheDocument();
    expect(bench.getAllByRole('checkbox')).toHaveLength(2);
    // prefilled: the target's reps and last time's weight
    expect(bench.getAllByLabelText('Επαναλήψεις')[0]).toHaveValue('8');
    expect(bench.getAllByLabelText('Κιλά')[0]).toHaveValue('52,5');
    const pullups = await card('Έλξεις');
    expect(pullups.getByText('1 × max')).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: '' })).toBeDefined();
  });

  it('starts a session once, by its own client id, for that plan day', async () => {
    renderDay();
    await card('Πιέσεις στήθους');
    await waitFor(() => expect(size()).toBe(0));
    const puts = calls.filter((c) => c.method === 'PUT' && !c.path.includes('/sets/'));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.path).toMatch(/^\/me\/sessions\/[0-9a-f-]{36}$/);
    expect(puts[0]!.body).toMatchObject({ planId: 'plan-1', planDayId: D1 });
  });

  it('ticking a set done saves it and starts the rest timer at the exercise’s rest', async () => {
    const user = userEvent.setup();
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    await user.click(bench.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 1' }));
    expect(await screen.findByRole('timer')).toHaveTextContent('1:30');
    await waitFor(() => expect(putSets()).toHaveLength(1));
    expect(putSets()[0]!.body).toMatchObject({
      exerciseId: X1,
      planExerciseId: 'pe1',
      setIndex: 0,
      reps: 8,
      weightKg: 52.5,
      done: true,
    });
    // an exercise without rest starts no timer
    await user.click(screen.getByRole('button', { name: 'Παράλειψη' }));
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('refuses to mark a set with no reps as done, and says why, instead of losing it', async () => {
    const user = userEvent.setup();
    renderDay();
    const pullups = await card('Έλξεις');
    await user.click(pullups.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 1' }));
    expect(pullups.getByRole('alert')).toHaveTextContent('Βάλε τουλάχιστον μία επανάληψη.');
    expect(pullups.getByRole('checkbox')).not.toBeChecked();
    expect(putSets()).toHaveLength(0);
    // typing a rep clears the complaint and the box works
    await user.click(pullups.getAllByLabelText('Επαναλήψεις')[0]!);
    await user.keyboard('5');
    expect(pullups.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(pullups.getByRole('checkbox'));
    await waitFor(() =>
      expect(putSets().at(-1)!.body).toMatchObject({ exerciseId: X2, reps: 5, done: true }),
    );
  });

  it('accepts a weight typed with a Greek comma and sends it as a number on the 0.25 grid', async () => {
    const user = userEvent.setup();
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    const kg = bench.getAllByLabelText('Κιλά')[0]!;
    await user.clear(kg);
    await user.type(kg, '22,5');
    await waitFor(() =>
      expect(putSets().at(-1)?.body).toMatchObject({ weightKg: 22.5, done: false }),
    );
    await user.clear(kg);
    await user.type(kg, '22,3');
    await waitFor(() => expect(putSets().at(-1)?.body).toMatchObject({ weightKg: 22.25 }));
    await user.tab();
    expect(kg).toHaveValue('22,25');
  });

  it('the steppers change reps by 1 and kilos by 2.5, never below zero', async () => {
    const user = userEvent.setup();
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    await user.click(bench.getByRole('button', { name: 'Περισσότερες επαναλήψεις στο σετ 1' }));
    expect(bench.getAllByLabelText('Επαναλήψεις')[0]).toHaveValue('9');
    await user.click(bench.getByRole('button', { name: 'Περισσότερα κιλά στο σετ 1' }));
    expect(bench.getAllByLabelText('Κιλά')[0]).toHaveValue('55');
    const less = bench.getByRole('button', { name: 'Λιγότερα κιλά στο σετ 2' });
    for (let i = 0; i < 25; i++) await user.click(less);
    expect(bench.getAllByLabelText('Κιλά')[1]).toHaveValue('0');
  });

  it('offline: the status counts what waits, and everything is sent once the phone is back online', async () => {
    const user = userEvent.setup();
    network = 'down';
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    await user.click(bench.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 1' }));
    await user.click(bench.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 2' }));
    // the session start and two sets
    expect(await screen.findByText('Χωρίς σύνδεση — θα αποθηκευτεί (3)')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(3);
    // the screen already shows the sets as done
    expect(bench.getAllByRole('checkbox')[0]).toBeChecked();

    network = 'up';
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => void window.dispatchEvent(new Event('online')));
    expect(await screen.findByText('Αποθηκεύτηκε')).toBeInTheDocument();
    expect(size()).toBe(0);
    // each once, in the order they were made
    const sent = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => c.path.split('/').slice(-2).join('/'));
    expect(sent[0]).toMatch(/^sessions\//);
    expect(putSets()).toHaveLength(2);
    expect(putSets().map((c) => c.body!.setIndex)).toEqual([0, 1]);
  });

  it('removes the last set of an exercise, deleting it on the server once it was saved', async () => {
    const user = userEvent.setup();
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    await user.click(bench.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 2' }));
    await waitFor(() => expect(putSets()).toHaveLength(1));
    await user.click(bench.getByRole('button', { name: 'Αφαίρεση σετ 2' }));
    expect(bench.getAllByRole('checkbox')).toHaveLength(1);
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    // an untouched extra row leaves no trace on the server
    await user.click(bench.getByRole('button', { name: 'Προσθήκη σετ' }));
    await user.click(bench.getByRole('button', { name: 'Αφαίρεση σετ 2' }));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('resumes the open session of the same plan day with the sets already logged', async () => {
    sessions = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        memberId: 'm',
        planId: 'plan-1',
        planDayId: D1,
        startedAt: '2027-05-12T08:00:00.000Z',
        finishedAt: null,
        notes: null,
        sets: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            exerciseId: X1,
            planExerciseId: 'pe1',
            measure: 'weight_reps',
            setIndex: 0,
            reps: 7,
            weightKg: 60,
            durationSeconds: null,
            done: true,
            loggedAt: '2027-05-12T08:05:00.000Z',
          },
        ],
      },
    ];
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    expect(bench.getAllByRole('checkbox')[0]).toBeChecked();
    expect(bench.getAllByLabelText('Κιλά')[0]).toHaveValue('60');
    // no new session was started
    expect(calls.filter((c) => c.method === 'PUT' && !c.path.includes('/sets/'))).toHaveLength(0);
  });

  it('finishing asks first, then shows the summary and sends the finish', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderDay(onExit);
    const bench = await card('Πιέσεις στήθους');
    await user.click(bench.getByRole('checkbox', { name: 'Ολοκληρώθηκε το σετ 1' }));
    await user.click(screen.getByRole('button', { name: 'Τέλος προπόνησης' }));
    await user.click(screen.getByRole('button', { name: 'Συνέχεια' })); // changed my mind
    await user.click(screen.getByRole('button', { name: 'Τέλος προπόνησης' }));
    await user.click(
      within(screen.getByRole('group', { name: 'Τέλος προπόνησης' })).getByRole('button', {
        name: 'Τέλος προπόνησης',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Μπράβο, τελείωσες!' })).toBeInTheDocument();
    expect(screen.getByText('420 kg')).toBeInTheDocument(); // 8 × 52.5
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/finish'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('keeps every control at least 44 px tall (inputs, steppers, done boxes, buttons)', async () => {
    renderDay();
    const bench = await card('Πιέσεις στήθους');
    const controls = [
      ...bench.getAllByRole('checkbox'),
      ...bench.getAllByRole('textbox'),
      ...bench.getAllByRole('button'),
    ];
    expect(controls.length).toBeGreaterThan(8);
    for (const el of controls)
      expect(el.className, el.outerHTML).toMatch(/\b(min-)?h-1[1-9]\b|min-h-1[1-9]/);
  });

  it('shows English labels and a dot decimal for an English viewer', async () => {
    await i18n.changeLanguage('en');
    renderDay();
    const bench = await card('Bench press');
    expect(bench.getByText('Last time: 52.5×10, 52.5×9')).toBeInTheDocument();
    expect(bench.getAllByLabelText('Kilos')[0]).toHaveValue('52.5');
  });
});

describe('FreeWorkoutPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('el');
    localStorage.clear();
    resetQueueForTests();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input).replace(`/api/gyms/${GYM}`, '');
        if ((init?.method ?? 'GET') === 'GET' && path.startsWith('/exercises'))
          return json(200, LIBRARY);
        if ((init?.method ?? 'GET') === 'GET' && path.startsWith('/me/sessions'))
          return json(200, []);
        if ((init?.method ?? 'GET') === 'GET') return json(200, []);
        return json(200, {});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates nothing until started, then picking an exercise adds a card with one row', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/freeWorkout`]}>
        <Routes>
          <Route path="/g/:gymId/*" element={<FreeWorkoutPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(size()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Ξεκίνα ελεύθερη προπόνηση' }));
    expect(await screen.findByText('Διάλεξε μια άσκηση για να ξεκινήσεις.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Προσθήκη άσκησης' }));
    const picker = await screen.findByRole('dialog', { name: 'Επιλογή άσκησης' });
    await user.click(await within(picker).findByRole('option', { name: /Πιέσεις στήθους/ }));
    const bench = within(await screen.findByRole('region', { name: 'Πιέσεις στήθους' }));
    expect(bench.getAllByRole('checkbox')).toHaveLength(1);
    expect(bench.queryByText(/Την προηγούμενη φορά/)).not.toBeInTheDocument();
    // a timed exercise asks for time, not reps
    await user.click(screen.getByRole('button', { name: 'Προσθήκη άσκησης' }));
    const picker2 = await screen.findByRole('dialog', { name: 'Επιλογή άσκησης' });
    await user.click(await within(picker2).findByRole('option', { name: /Σανίδα/ }));
    const plank = within(await screen.findByRole('region', { name: 'Σανίδα' }));
    expect(plank.getByLabelText('Χρόνος (λ:δδ)')).toHaveValue('1:00');
    expect(plank.queryByLabelText('Κιλά')).not.toBeInTheDocument();
  });
});
