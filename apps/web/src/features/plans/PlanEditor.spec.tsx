import type { Exercise, Plan } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { PlanEditor } from './PlanEditor';

const lib = (
  n: number,
  nameEl: string,
  measure: Exercise['measure'],
  group: Exercise['muscleGroup'],
): Exercise => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  nameEl,
  nameEn: null,
  muscleGroup: group,
  measure,
  archived: false,
  createdBy: null,
});
const BENCH = lib(1, 'Πιέσεις στήθους', 'weight_reps', 'chest');
const PULL = lib(2, 'Έλξεις', 'reps', 'back');
const PLANK = lib(3, 'Σανίδα', 'duration', 'core');
const LIBRARY = [BENCH, PULL, PLANK];

const info = (e: Exercise) => ({
  nameEl: e.nameEl,
  nameEn: e.nameEn,
  muscleGroup: e.muscleGroup,
  measure: e.measure,
  archived: false,
});

const stored: Plan = {
  id: 'plan-1',
  memberId: MEMBER,
  authorId: 't1',
  author: { firstName: 'Νίκος', lastName: 'Γυμναστής' },
  isTemplate: false,
  kind: 'interactive',
  title: 'Πάνω σώμα',
  notes: null,
  status: 'draft',
  pdfUrl: null,
  activatedAt: null,
  days: [
    {
      id: 'd1111111-1111-4111-8111-111111111111',
      title: 'Ημέρα Α',
      exercises: [
        {
          id: 'e1111111-1111-4111-8111-111111111111',
          exerciseId: BENCH.id,
          exercise: info(BENCH),
          sets: 4,
          repsMin: 8,
          repsMax: 10,
          toFailure: false,
          weightKg: 50,
          restSeconds: 90,
          durationSeconds: null,
          notes: null,
        },
        {
          id: 'e2222222-2222-4222-8222-222222222222',
          exerciseId: PULL.id,
          exercise: info(PULL),
          sets: 3,
          repsMin: null,
          repsMax: null,
          toFailure: true,
          weightKg: null,
          restSeconds: null,
          durationSeconds: null,
          notes: null,
        },
      ],
    },
    { id: 'd2222222-2222-4222-8222-222222222222', title: 'Ημέρα Β', exercises: [] },
  ],
};

describe('PlanEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const onClose = vi.fn<() => void>();
  const onSaved = vi.fn<(p: Plan) => void>();
  const writes = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method && init.method !== 'GET')
      .map(([url, init]) => ({
        url: String(url).replace(`/api/gyms/${GYM}`, ''),
        method: init!.method!,
        body: init!.body ? (JSON.parse(String(init!.body)) as Record<string, unknown>) : undefined,
      }));

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    onClose.mockClear();
    onSaved.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/exercises')) return json(200, LIBRARY);
      if (init?.method === 'POST' && url.endsWith('/save-as-template'))
        return json(201, { ...stored, id: 'tpl-1', isTemplate: true, memberId: null });
      if (init?.method === 'POST' && url.endsWith('/activate'))
        return json(200, { ...stored, status: 'active' });
      if (init?.method === 'POST' && url.endsWith('/plans'))
        return json(201, { ...stored, id: 'plan-new' });
      if (init?.method === 'POST' && url.endsWith('/plan-templates'))
        return json(201, { ...stored, id: 'tpl-new', isTemplate: true, memberId: null });
      if (init?.method === 'PUT') return json(200, stored);
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderEditor = (plan: Plan | null = stored, mode: 'plan' | 'template' = 'plan') =>
    render(
      <PlanEditor
        gymId={GYM}
        memberId={mode === 'plan' ? MEMBER : undefined}
        plan={plan}
        mode={mode}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
  const row = (name: string) => screen.getByRole('group', { name: `Στοιχεία άσκησης «${name}»` });
  const days = () => screen.getAllByRole('region');

  it('starts from the stored plan: title, days and rows with their values', () => {
    renderEditor();
    expect(screen.getByLabelText('Τίτλος προγράμματος')).toHaveValue('Πάνω σώμα');
    expect(
      screen.getAllByLabelText('Όνομα ημέρας').map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Ημέρα Α', 'Ημέρα Β']);
    const bench = row('Πιέσεις στήθους');
    expect(within(bench).getByLabelText('Σετ')).toHaveValue(4);
    expect(within(bench).getByLabelText('Επαναλήψεις από')).toHaveValue(8);
    expect(within(bench).getByLabelText('Επαναλήψεις έως')).toHaveValue(10);
    expect(within(bench).getByLabelText('Βάρος (kg)')).toHaveValue(50);
    expect(within(bench).getByLabelText('Ανάπαυση (δευτ.)')).toHaveValue(90);
  });

  it('adds an exercise from the library picker as a new row in that day', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Προσθήκη άσκησης στην ημέρα «Ημέρα Β»' }));
    await user.click(await screen.findByRole('option', { name: /Σανίδα/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const dayB = within(days()[1]!);
    expect(dayB.getByRole('group', { name: 'Στοιχεία άσκησης «Σανίδα»' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = writes().find((w) => w.method === 'PUT')!;
    const sentDays = put.body!.days as {
      id?: string;
      exercises: { id?: string; exerciseId: string }[];
    }[];
    expect(sentDays[1]!.id).toBe('d2222222-2222-4222-8222-222222222222');
    expect(sentDays[1]!.exercises).toHaveLength(1);
    expect(sentDays[1]!.exercises[0]!.exerciseId).toBe(PLANK.id);
    expect(sentDays[1]!.exercises[0]).not.toHaveProperty('id'); // new items carry no id
  });

  it('moving day 2 up sends the days in the new order and keeps their ids', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Μετακίνηση ημέρας «Ημέρα Β» πάνω' }));
    expect(
      screen.getAllByLabelText('Όνομα ημέρας').map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Ημέρα Β', 'Ημέρα Α']);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = writes().find((w) => w.method === 'PUT')!;
    const sent = put.body!.days as { id: string; exercises: { id: string }[] }[];
    expect(sent.map((d) => d.id)).toEqual([
      'd2222222-2222-4222-8222-222222222222',
      'd1111111-1111-4111-8111-111111111111',
    ]);
    expect(sent[1]!.exercises.map((e) => e.id)).toEqual([
      'e1111111-1111-4111-8111-111111111111',
      'e2222222-2222-4222-8222-222222222222',
    ]);
  });

  it('moves an exercise up and down inside its day, keeping ids', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Μετακίνηση «Έλξεις» πάνω' }));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = (
      writes().find((w) => w.method === 'PUT')!.body!.days as { exercises: { id: string }[] }[]
    )[0]!;
    expect(sent.exercises.map((e) => e.id)).toEqual([
      'e2222222-2222-4222-8222-222222222222',
      'e1111111-1111-4111-8111-111111111111',
    ]);
  });

  it('"to failure" clears and disables the reps fields, and sends no reps', async () => {
    const user = userEvent.setup();
    renderEditor();
    const bench = row('Πιέσεις στήθους');
    await user.click(within(bench).getByLabelText('Μέχρι αποτυχίας'));
    expect(within(bench).getByLabelText('Επαναλήψεις από')).toBeDisabled();
    expect(within(bench).getByLabelText('Επαναλήψεις από')).toHaveValue(null);
    expect(within(bench).getByLabelText('Επαναλήψεις έως')).toBeDisabled();
    expect(within(bench).getByLabelText('Επαναλήψεις έως')).toHaveValue(null);
    // Switching it off lets the trainer type reps again; switching it on again drops them.
    await user.click(within(bench).getByLabelText('Μέχρι αποτυχίας'));
    expect(within(bench).getByLabelText('Επαναλήψεις από')).toBeEnabled();
    await user.type(within(bench).getByLabelText('Επαναλήψεις από'), '6');
    await user.click(within(bench).getByLabelText('Μέχρι αποτυχίας'));
    expect(within(bench).getByLabelText('Επαναλήψεις από')).toHaveValue(null);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = (
      writes().find((w) => w.method === 'PUT')!.body!.days as {
        exercises: Record<string, unknown>[];
      }[]
    )[0]!;
    expect(sent.exercises[0]).toMatchObject({ toFailure: true, repsMin: null, repsMax: null });
  });

  it('a timed exercise asks for seconds, not reps and kilos', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Προσθήκη άσκησης στην ημέρα «Ημέρα Β»' }));
    await user.click(await screen.findByRole('option', { name: /Σανίδα/ }));
    const plank = row('Σανίδα');
    expect(within(plank).getByLabelText('Διάρκεια (δευτ.)')).toHaveValue(60);
    expect(within(plank).queryByLabelText('Επαναλήψεις από')).toBeNull();
    expect(within(plank).queryByLabelText('Βάρος (kg)')).toBeNull();
    expect(within(plank).queryByLabelText('Μέχρι αποτυχίας')).toBeNull();
    expect(within(row('Πιέσεις στήθους')).queryByLabelText('Διάρκεια (δευτ.)')).toBeNull();
  });

  it('the weight field opens a decimal keyboard and takes quarter kilos', async () => {
    const user = userEvent.setup();
    renderEditor();
    const weight = within(row('Πιέσεις στήθους')).getByLabelText('Βάρος (kg)');
    expect(weight).toHaveAttribute('inputmode', 'decimal');
    expect(weight).toHaveAttribute('step', '0.25');
    await user.clear(weight);
    await user.type(weight, '22.5');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = (
      writes().find((w) => w.method === 'PUT')!.body!.days as {
        exercises: Record<string, unknown>[];
      }[]
    )[0]!;
    expect(sent.exercises[0]!.weightKg).toBe(22.5);
  });

  it('removing a day asks first, and only then drops it with its exercises', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Αφαίρεση ημέρας «Ημέρα Α»' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    expect(screen.getAllByLabelText('Όνομα ημέρας')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Αφαίρεση ημέρας «Ημέρα Α»' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Αφαίρεση ημέρας',
      }),
    );
    expect(screen.getAllByLabelText('Όνομα ημέρας')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Στοιχεία άσκησης «Πιέσεις στήθους»' })).toBeNull();
  });

  it('adds a day and removes an exercise without asking', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Προσθήκη ημέρας' }));
    expect(screen.getAllByLabelText('Όνομα ημέρας')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Αφαίρεση «Έλξεις»' }));
    expect(screen.queryByRole('group', { name: 'Στοιχεία άσκησης «Έλξεις»' })).toBeNull();
  });

  it('closes at once when nothing changed, and asks before throwing changes away', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), ' νέο');
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Έχεις αλλαγές που δεν έχουν αποθηκευτεί.');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Συνέχεια επεξεργασίας' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Απόρριψη αλλαγών',
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
  });

  it('warns the browser about unsaved changes while there are some, not after saving', async () => {
    const user = userEvent.setup();
    renderEditor();
    const blocked = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(blocked()).toBe(false);
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), '!');
    expect(blocked()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(blocked()).toBe(false);
  });

  it('a new plan is created with a POST and no ids; the days keep their order', async () => {
    const user = userEvent.setup();
    renderEditor(null);
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), 'Νέο πρόγραμμα');
    await user.click(screen.getByRole('button', { name: 'Προσθήκη άσκησης στην ημέρα «Ημέρα Α»' }));
    await user.click(await screen.findByRole('option', { name: /Πιέσεις στήθους/ }));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [call] = writes();
    expect(call).toMatchObject({ method: 'POST', url: `/members/${MEMBER}/plans` });
    expect(call!.body).not.toHaveProperty('activate');
    const sentDay = (
      call!.body!.days as { id?: string; title: string; exercises: unknown[] }[]
    )[0]!;
    expect(sentDay).not.toHaveProperty('id');
    expect(sentDay.title).toBe('Ημέρα Α');
    expect(onSaved.mock.calls[0]![0].id).toBe('plan-new');
  });

  it('"save and activate": a new plan is created active in one request', async () => {
    const user = userEvent.setup();
    renderEditor(null);
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), 'Ενεργό');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.body).toMatchObject({ title: 'Ενεργό', activate: true });
  });

  it('"save and activate" on a stored plan saves it, then activates it', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      'PUT /plans/plan-1',
      'POST /plans/plan-1/activate',
    ]);
    expect(onSaved.mock.calls[0]![0].status).toBe('active');
  });

  it('"save as template" saves the plan first, then copies it, and stays open with a message', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), ' (πρότυπο)');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση ως πρότυπο' }));
    expect(
      await screen.findByText('✓ Αποθηκεύτηκε ως πρότυπο «Πάνω σώμα (πρότυπο)».'),
    ).toBeInTheDocument();
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      'PUT /plans/plan-1',
      'POST /plans/plan-1/save-as-template',
    ]);
    expect(writes()[1]!.body).toEqual({ title: 'Πάνω σώμα (πρότυπο)' });
    expect(onClose).not.toHaveBeenCalled();
    // Saved and not changed since: closing needs no question.
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('will not save a plan without a title, a day without a name, or reps from above to', async () => {
    const user = userEvent.setup();
    renderEditor(null);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Δώσε τίτλο στο πρόγραμμα.')).toBeInTheDocument();
    expect(screen.getByLabelText('Τίτλος προγράμματος')).toHaveFocus();
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), 'Χ');
    await user.clear(screen.getByLabelText('Όνομα ημέρας'));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Δώσε όνομα σε κάθε ημέρα.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Όνομα ημέρας'), 'Α');
    await user.click(screen.getByRole('button', { name: 'Προσθήκη άσκησης στην ημέρα «Α»' }));
    await user.click(await screen.findByRole('option', { name: /Πιέσεις στήθους/ }));
    const min = within(row('Πιέσεις στήθους')).getByLabelText('Επαναλήψεις από');
    await user.clear(min);
    await user.type(min, '15'); // from 15 to 12
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText(/Έλεγξε τα στοιχεία των ασκήσεων/)).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it('lets the trainer clear the sets field and type a new number (it never snaps back to 1)', async () => {
    const user = userEvent.setup();
    renderEditor();
    const sets = within(row('Πιέσεις στήθους')).getByLabelText('Σετ');
    await user.clear(sets);
    expect(sets).toHaveValue(null);
    await user.type(sets, '5');
    expect(sets).toHaveValue(5);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const sent = (
      writes().find((w) => w.method === 'PUT')!.body!.days as { exercises: { sets: number }[] }[]
    )[0]!;
    expect(sent.exercises[0]!.sets).toBe(5);
  });

  it('will not save an exercise whose sets were left empty, and puts focus on the message', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.clear(within(row('Πιέσεις στήθους')).getByLabelText('Σετ'));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Έλεγξε τα στοιχεία των ασκήσεων');
    // Focus moves in the next animation frame, after the message is on screen.
    await waitFor(() => expect(alert).toHaveFocus());
    expect(writes()).toEqual([]);
  });

  it('puts focus on the day name that is missing', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.clear(screen.getAllByLabelText('Όνομα ημέρας')[1]!);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Δώσε όνομα σε κάθε ημέρα.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Όνομα ημέρας')[1]).toHaveFocus();
    expect(screen.getAllByLabelText('Όνομα ημέρας')[1]).toHaveAttribute('aria-invalid', 'true');
  });

  it('says what was saved when the activation that follows fails, and keeps the saved plan', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/exercises')) return json(200, LIBRARY);
      if (init?.method === 'POST' && url.endsWith('/activate')) return json(500, {});
      if (init?.method === 'PUT') return json(200, stored);
      return json(404, {});
    });
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' }));
    expect(
      await screen.findByText(
        'Αποθηκεύτηκε, αλλά δεν ενεργοποιήθηκε. Δοκίμασε ξανά την ενεργοποίηση.',
      ),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.')).toBeNull();
    // Nothing is left to save: closing needs no question.
    await user.click(screen.getByRole('button', { name: 'Κλείσιμο' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says what was saved when copying it as a template fails afterwards', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/exercises')) return json(200, LIBRARY);
      if (init?.method === 'POST' && url.endsWith('/save-as-template')) return json(500, {});
      if (init?.method === 'PUT') return json(200, stored);
      return json(404, {});
    });
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση ως πρότυπο' }));
    expect(
      await screen.findByText('Το πρόγραμμα αποθηκεύτηκε, αλλά δεν δημιουργήθηκε το πρότυπο.'),
    ).toBeInTheDocument();
  });

  it('offers "save and activate" only for a plan that is not active yet', () => {
    const { unmount } = renderEditor({
      ...stored,
      status: 'active',
      activatedAt: '2027-05-12T09:00:00.000Z',
    });
    expect(screen.queryByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Αποθήκευση' })).toBeInTheDocument();
    unmount();
    renderEditor(stored);
    expect(screen.getByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' })).toBeInTheDocument();
  });

  it('keeps a day collapsed after saving', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Σύμπτυξη ημέρας «Ημέρα Α»' }));
    expect(screen.getByRole('button', { name: 'Ανάπτυξη ημέρας «Ημέρα Α»' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση ως πρότυπο' })); // stays open
    await screen.findByText(/Αποθηκεύτηκε ως πρότυπο/);
    expect(screen.getByRole('button', { name: 'Ανάπτυξη ημέρας «Ημέρα Α»' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps keyboard focus on a move button when the item reaches the end of its list', async () => {
    const user = userEvent.setup();
    renderEditor();
    screen.getByRole('button', { name: 'Μετακίνηση «Πιέσεις στήθους» κάτω' }).focus();
    await user.keyboard('{Enter}');
    const after = screen.getByRole('button', { name: 'Μετακίνηση «Πιέσεις στήθους» κάτω' });
    expect(after).toHaveAttribute('aria-disabled', 'true');
    expect(after).toHaveFocus();
    await user.keyboard('{Enter}'); // a no-op at the end
    expect(screen.getAllByRole('group', { name: /Στοιχεία άσκησης/ })).toHaveLength(2);
  });

  it('keeps the draft and says so when the save fails', async () => {
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'PUT' ? json(500, {}) : json(200, LIBRARY),
    );
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), '!');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Δεν αποθηκεύτηκε. Δοκίμασε ξανά.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Τίτλος προγράμματος')).toHaveValue('Πάνω σώμα!');
  });

  it('a template is saved through the template routes, with no activate or template buttons', async () => {
    const user = userEvent.setup();
    renderEditor({ ...stored, id: 'tpl-1', isTemplate: true, memberId: null }, 'template');
    expect(screen.queryByRole('button', { name: 'Αποθήκευση και ενεργοποίηση' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Αποθήκευση ως πρότυπο' })).toBeNull();
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), '!');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual(['PUT /plan-templates/tpl-1']);
  });

  it('a new template is created at the template route', async () => {
    const user = userEvent.setup();
    renderEditor(null, 'template');
    await user.type(screen.getByLabelText('Τίτλος προγράμματος'), 'Ολόκληρο σώμα');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual(['POST /plan-templates']);
  });

  it('shows that an archived exercise stays in the plan', () => {
    const archived: Plan = {
      ...stored,
      days: [
        {
          ...stored.days[0]!,
          exercises: [
            { ...stored.days[0]!.exercises[0]!, exercise: { ...info(BENCH), archived: true } },
          ],
        },
      ],
    };
    renderEditor(archived);
    expect(
      within(row('Πιέσεις στήθους')).getByText(
        'Αυτή η άσκηση έχει αρχειοθετηθεί, αλλά μένει στο πρόγραμμα.',
      ),
    ).toBeInTheDocument();
  });
});
