import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ClassSessionDialog } from './ClassSessionDialog';
import { SPINNING, TRAINER } from './test-data';

describe('ClassSessionDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let status: number;
  const onSaved = vi.fn();

  beforeEach(() => {
    status = 200;
    onSaved.mockClear();
    fetchMock = vi.fn<typeof fetch>(async () => json(status, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = () =>
    render(
      <ClassSessionDialog
        gymId={GYM}
        types={[SPINNING]}
        trainers={[TRAINER]}
        today="2027-05-12"
        date="2027-05-14"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
  const submit = () => userEvent.click(screen.getByRole('button', { name: 'Δημιουργία' }));

  it('adds a one-off class on the chosen day', async () => {
    renderDialog();
    expect(screen.getByLabelText('Ημερομηνία')).toHaveValue('2027-05-14');
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    await userEvent.selectOptions(screen.getByLabelText('Γυμναστής'), TRAINER.userId);
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/class-sessions`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      classTypeId: SPINNING.id,
      date: '2027-05-14',
      startsAt: '18:00',
      durationMinutes: 45,
      capacity: 12,
      trainerId: TRAINER.userId,
      room: null,
    });
  });

  it('sends nothing without a type or on a past date', async () => {
    renderDialog();
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Είδος μαθήματος')).toBeInvalid();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    const date = screen.getByLabelText('Ημερομηνία');
    await userEvent.clear(date);
    await userEvent.type(date, '2027-05-01');
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(date).toBeInvalid();
  });

  it('accepts today itself as the date (only earlier days are refused)', async () => {
    renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    const date = screen.getByLabelText('Ημερομηνία');
    await userEvent.clear(date);
    await userEvent.type(date, '2027-05-12');
    await submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      date: '2027-05-12',
    });
  });

  it('shows an error and stays open when the server refuses', async () => {
    status = 500;
    renderDialog();
    await userEvent.selectOptions(screen.getByLabelText('Είδος μαθήματος'), SPINNING.id);
    await submit();
    // The alert region is always in the page, so wait for its text, not for the region.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά'),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
