import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ClassSeriesDialog, type SeriesChange } from './ClassSeriesDialog';
import { PILATES, SPINNING, TRAINER } from './test-data';

const TODAY = '2027-05-12'; // a Wednesday

describe('ClassSeriesDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let failPath: string | null;
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    failPath = null;
    onClose.mockClear();
    onSaved.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input) =>
      failPath && String(input).endsWith(failPath)
        ? json(500, {})
        : new Response(JSON.stringify({ id: 'x' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = (change?: SeriesChange) =>
    render(
      <ClassSeriesDialog
        gymId={GYM}
        types={[SPINNING, PILATES, { ...PILATES, id: 'old', name: 'Αρχειοθετημένο', archived: true }]}
        trainers={[TRAINER]}
        today={TODAY}
        change={change}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
  const calls = () => fetchMock.mock.calls.map(([u, i]) => [String(u), i] as const);
  const bodyOf = (n: number) => JSON.parse(String(calls()[n]![1]!.body)) as Record<string, unknown>;
  const submit = () => userEvent.click(screen.getByRole('button', { name: /Δημιουργία|Αλλαγή από αυτή τη μέρα/ }));

  it('refuses a missing type, a class that crosses midnight, and 0 spots, sending nothing', async () => {
    renderDialog();
    await submit();
    expect(calls()).toHaveLength(0);
    expect(screen.getByLabelText('Είδος μαθήματος')).toBeInvalid();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    await userEvent.clear(screen.getByLabelText('Ώρα έναρξης'));
    await userEvent.type(screen.getByLabelText('Ώρα έναρξης'), '23:30');
    await submit();
    expect(screen.getByLabelText(/Διάρκεια/)).toHaveAccessibleDescription(/πριν τα μεσάνυχτα/);
    await userEvent.clear(screen.getByLabelText('Θέσεις'));
    await userEvent.type(screen.getByLabelText('Θέσεις'), '0');
    await submit();
    expect(screen.getByLabelText('Θέσεις')).toBeInvalid();
    expect(calls()).toHaveLength(0);
  });

  it('does not offer archived types, and filling the type sets capacity and length', async () => {
    renderDialog();
    expect(screen.queryByRole('option', { name: 'Αρχειοθετημένο' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), PILATES.id);
    expect(screen.getByLabelText('Θέσεις')).toHaveValue(10);
    expect(screen.getByLabelText(/Διάρκεια/)).toHaveValue(50);
  });

  it('creates a weekly class on the weekday of its first day', async () => {
    renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    await userEvent.selectOptions(screen.getByLabelText('Γυμναστής'), TRAINER.userId);
    await userEvent.type(screen.getByLabelText('Αίθουσα'), 'Α');
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()).toHaveLength(1);
    expect(calls()[0]![0]).toBe(`/api/gyms/${GYM}/class-series`);
    expect(bodyOf(0)).toEqual({
      classTypeId: SPINNING.id,
      weekday: 3,
      startsAt: '18:00',
      durationMinutes: 45,
      capacity: 12,
      trainerId: TRAINER.userId,
      room: 'Α',
      validFrom: TODAY,
    });
  });

  it('refuses a start date in the past', async () => {
    renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    const date = screen.getByLabelText('Ξεκινά στις');
    await userEvent.clear(date);
    await userEvent.type(date, '2027-05-01');
    await submit();
    expect(calls()).toHaveLength(0);
    expect(date).toBeInvalid();
  });

  const change: SeriesChange = {
    seriesId: 'series-1',
    from: '2027-05-19',
    values: {
      classTypeId: SPINNING.id,
      startsAt: '18:00',
      duration: '45',
      capacity: '12',
      trainerId: '',
      room: '',
    },
  };

  it('a change from a day ends the old series the day before, then starts the new one', async () => {
    renderDialog(change);
    await userEvent.clear(screen.getByLabelText('Θέσεις'));
    await userEvent.type(screen.getByLabelText('Θέσεις'), '8');
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls().map(([u]) => u)).toEqual([
      `/api/gyms/${GYM}/class-series/series-1/end`,
      `/api/gyms/${GYM}/class-series`,
    ]);
    expect(bodyOf(0)).toEqual({ lastDate: '2027-05-18' });
    expect(bodyOf(1)).toMatchObject({ weekday: 3, validFrom: '2027-05-19', capacity: 8 });
  });

  it('when starting the new series fails, a retry only starts it (the old one already ended)', async () => {
    failPath = '/class-series';
    renderDialog(change);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Το παλιό πρόγραμμα έχει ήδη τελειώσει');
    expect(onSaved).not.toHaveBeenCalled();
    failPath = null;
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const ends = calls().filter(([u]) => u.endsWith('/end'));
    expect(ends).toHaveLength(1);
  });

  it('a failure before anything changed shows the generic error and stays open', async () => {
    failPath = '/class-series';
    renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
