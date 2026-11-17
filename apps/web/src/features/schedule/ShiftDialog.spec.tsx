import type { ExpandedShift, ScheduleStaff } from '@gym/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ShiftDialog, type ShiftTarget } from './ShiftDialog';

const NIKOS: ScheduleStaff = {
  userId: '2b2b2b2b-2222-4222-8222-222222222222',
  firstName: 'Νίκος',
  lastName: 'Γυμναστής',
  roles: ['trainer'],
};
const SERIES = '5d5d5d5d-5555-4555-8555-555555555555';
const ONE_OFF = '6e6e6e6e-6666-4666-8666-666666666666';
const weekly: ExpandedShift = {
  staffId: NIKOS.userId,
  date: '2027-05-10', // a Monday
  startsAt: '06:00',
  endsAt: '14:00',
  seriesId: SERIES,
  shiftId: null,
  note: null,
};
const oneOff: ExpandedShift = { ...weekly, seriesId: null, shiftId: ONE_OFF, date: '2027-05-12' };

describe('ShiftDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let onSaved: ReturnType<typeof vi.fn<() => void>>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (_i, init) =>
      init?.method === 'POST' || init?.method === 'PUT' || init?.method === 'PATCH'
        ? json(200, { id: 'x' })
        : new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    onSaved = vi.fn();
    onClose = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = (target: ShiftTarget, staff: ScheduleStaff[] = [NIKOS]) =>
    render(
      <ShiftDialog gymId={GYM} staff={staff} target={target} onClose={onClose} onSaved={onSaved} />,
    );
  const calls = () =>
    fetchMock.mock.calls.map(([u, i]) => ({
      method: i?.method ?? 'GET',
      url: String(u).replace(`/api/gyms/${GYM}`, ''),
      body: i?.body ? (JSON.parse(String(i.body)) as unknown) : undefined,
    }));
  const setTimes = async (user: ReturnType<typeof userEvent.setup>, from: string, to: string) => {
    const start = screen.getByLabelText('Από');
    const end = screen.getByLabelText('Έως');
    await user.clear(start);
    await user.type(start, from);
    await user.clear(end);
    await user.type(end, to);
  };

  it('adds a one-off shift on the clicked day', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: NIKOS.userId, date: '2027-05-12' });
    await setTimes(user, '09:00', '12:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        method: 'POST',
        url: '/shifts',
        body: { staffId: NIKOS.userId, date: '2027-05-12', startsAt: '09:00', endsAt: '12:00' },
      },
    ]);
  });

  it('adds a weekly series from that day when "every week" is ticked', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: NIKOS.userId, date: '2027-05-12' }); // a Wednesday
    await setTimes(user, '06:00', '14:00');
    await user.click(screen.getByRole('checkbox', { name: /Κάθε εβδομάδα/ }));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()).toEqual([
      {
        method: 'POST',
        url: '/shift-series',
        body: {
          staffId: NIKOS.userId,
          weekday: 3,
          startsAt: '06:00',
          endsAt: '14:00',
          validFrom: '2027-05-12',
        },
      },
    ]);
  });

  it('asks who when opened from the day list, and sends nothing before a person is chosen', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: null, date: '2027-05-12' }, [
      NIKOS,
      { ...NIKOS, userId: '9f9f9f9f-9999-4999-8999-999999999999', firstName: 'Μαρία' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Διάλεξε άτομο.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.selectOptions(
      screen.getByLabelText('Άτομο'),
      '9f9f9f9f-9999-4999-8999-999999999999',
    );
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0]!.body).toMatchObject({ staffId: '9f9f9f9f-9999-4999-8999-999999999999' });
  });

  it('rejects an end time that is not after the start without sending anything', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: NIKOS.userId, date: '2027-05-12' });
    await setTimes(user, '14:00', '06:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Η λήξη πρέπει να είναι μετά την έναρξη.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an end time equal to the start', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: NIKOS.userId, date: '2027-05-12' });
    await setTimes(user, '09:00', '09:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Η λήξη πρέπει να είναι μετά την έναρξη.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('"from this day on" does not start the new series when ending the old one failed', async () => {
    fetchMock.mockImplementationOnce(async () => json(409, {}));
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: weekly });
    await user.click(screen.getByRole('radio', { name: /και μετά/ }));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // only the end request was sent; a new series now would overlap the old one
    expect(calls()).toEqual([
      { method: 'POST', url: `/shift-series/${SERIES}/end`, body: { lastDate: '2027-05-09' } },
    ]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('"from this day on" ends the old series the day before across a month boundary', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: { ...weekly, date: '2027-06-01' } }); // a Tuesday
    await user.click(screen.getByRole('radio', { name: /και μετά/ }));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls().map((c) => c.body)).toEqual([
      { lastDate: '2027-05-31' },
      expect.objectContaining({ weekday: 2, validFrom: '2027-06-01' }),
    ]);
  });

  it('changes only this day of a weekly shift with the occurrence PUT', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: weekly });
    expect(screen.getByRole('radio', { name: /Μόνο/ })).toBeChecked();
    await setTimes(user, '10:00', '18:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()).toEqual([
      {
        method: 'PUT',
        url: `/shift-series/${SERIES}/occurrences/2027-05-10`,
        body: { startsAt: '10:00', endsAt: '18:00', note: null },
      },
    ]);
  });

  it('changes a weekly shift from this day on: ends the series the day before, then starts a new one', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: weekly });
    await user.click(screen.getByRole('radio', { name: /και μετά/ }));
    await setTimes(user, '08:00', '16:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()).toEqual([
      { method: 'POST', url: `/shift-series/${SERIES}/end`, body: { lastDate: '2027-05-09' } },
      {
        method: 'POST',
        url: '/shift-series',
        body: {
          staffId: NIKOS.userId,
          weekday: 1,
          startsAt: '08:00',
          endsAt: '16:00',
          validFrom: '2027-05-10',
        },
      },
    ]);
  });

  it('cancels just this day, or ends the weekly shift from this day, with the matching button', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: weekly });
    await user.click(screen.getByRole('button', { name: 'Ακύρωση βάρδιας αυτής της μέρας' }));
    // nothing is sent before the question is answered
    expect(await screen.findByText(/Να ακυρωθεί η βάρδια της ημέρας/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Ναι, συνέχεια' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        method: 'PUT',
        url: `/shift-series/${SERIES}/occurrences/2027-05-10`,
        body: { cancelled: true },
      },
    ]);
    fetchMock.mockClear();
    await user.click(screen.getByRole('radio', { name: /και μετά/ }));
    await user.click(screen.getByRole('button', { name: 'Τέλος εβδομαδιαίας βάρδιας από εδώ' }));
    expect(await screen.findByText(/Οι προηγούμενες μέρες δεν αλλάζουν\.$/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Ναι, συνέχεια' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(calls()).toEqual([
      { method: 'POST', url: `/shift-series/${SERIES}/end`, body: { lastDate: '2027-05-09' } },
    ]);
  });

  it('edits and deletes a one-off shift', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: oneOff });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await setTimes(user, '09:00', '13:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      { method: 'PATCH', url: `/shifts/${ONE_OFF}`, body: { startsAt: '09:00', endsAt: '13:00' } },
    ]);
    fetchMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'Διαγραφή βάρδιας' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Άκυρο' })); // changed my mind
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Διαγραφή βάρδιας' }));
    await user.click(screen.getByRole('button', { name: 'Ναι, συνέχεια' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(calls()).toEqual([{ method: 'DELETE', url: `/shifts/${ONE_OFF}`, body: undefined }]);
  });

  it('shows an error and stays open when the API refuses', async () => {
    fetchMock.mockImplementationOnce(async () => json(409, {}));
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: NIKOS.userId, date: '2027-05-12' });
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('when the new series cannot be created, restores the old times, reloads and says what happened', async () => {
    const onChanged = vi.fn<() => void>();
    let seriesPosts = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/shift-series') && init?.method === 'POST') {
        seriesPosts += 1;
        return seriesPosts === 1 ? json(409, {}) : json(200, { id: 'x' });
      }
      return init?.method === 'POST' ? new Response(null, { status: 204 }) : json(200, {});
    });
    const user = userEvent.setup();
    render(
      <ShiftDialog
        gymId={GYM}
        staff={[NIKOS]}
        target={{ kind: 'edit', shift: weekly }}
        onClose={onClose}
        onSaved={onSaved}
        onChanged={onChanged}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /και μετά/ }));
    await setTimes(user, '08:00', '16:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Η αλλαγή δεν ολοκληρώθηκε');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    const series = calls().filter((c) => c.url === '/shift-series');
    expect(series).toHaveLength(2);
    expect(series[1]!.body).toMatchObject({
      startsAt: '06:00',
      endsAt: '14:00',
      validFrom: '2027-05-10',
    });
  });

  it('ties a field error to its field and moves focus there', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'new', staffId: NIKOS.userId, date: '2027-05-12' });
    await setTimes(user, '14:00', '06:00');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    const end = screen.getByLabelText('Έως');
    expect(end).toHaveFocus();
    expect(end).toHaveAttribute('aria-invalid', 'true');
    expect(end).toHaveAccessibleDescription('Η λήξη πρέπει να είναι μετά την έναρξη.');
    await user.clear(end);
    await user.type(end, '15:00');
    expect(end).not.toHaveAttribute('aria-invalid');
  });

  it('keeps the note of a changed day', async () => {
    const user = userEvent.setup();
    renderDialog({ kind: 'edit', shift: { ...weekly, note: 'Εκπαίδευση' } });
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0]!.body).toMatchObject({ note: 'Εκπαίδευση' });
  });
});
