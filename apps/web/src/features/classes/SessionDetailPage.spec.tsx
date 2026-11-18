import type { Attendee } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { SessionDetailPage } from './SessionDetailPage';
import { attendee, classSession } from './test-data';

describe('SessionDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let attendees: Attendee[];
  let postStatus: number;
  const onBack = vi.fn();
  const onChanged = vi.fn();

  beforeEach(() => {
    attendees = [
      attendee({ id: 'b1', member: { id: 'u1', firstName: 'Μαρία', lastName: 'Νικολάου', photoUrl: null } }),
      attendee({
        id: 'b2',
        status: 'attended',
        member: { id: 'u2', firstName: 'Γιάννης', lastName: 'Κώστας', photoUrl: null },
      }),
    ];
    postStatus = 204;
    onBack.mockClear();
    onChanged.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return postStatus === 204
          ? new Response(null, { status: 204 })
          : json(postStatus, { message: postStatus === 409 ? 'Class full' : 'x' });
      }
      if (url.includes('/members?q=')) {
        return json(200, [{ userId: 'u9', firstName: 'Ελένη', lastName: 'Δήμου' }]);
      }
      return json(200, attendees);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST');
  const renderPage = (over: Partial<Parameters<typeof SessionDetailPage>[0]> = {}) =>
    render(
      <SessionDetailPage
        gymId={GYM}
        session={classSession({ id: 's1', booked: 2 })}
        canManage
        canBook
        onBack={onBack}
        onChanged={onChanged}
        {...over}
      />,
    );

  it('lists who is booked with a status chip each', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Κρατήσεις' });
    expect(within(list).getAllByText('Μαρία Νικολάου')[0]).toBeVisible();
    expect(screen.getByTestId('chip-b1')).toHaveTextContent('Κράτηση');
    expect(screen.getByTestId('chip-b2')).toHaveTextContent('Παρών');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/class-sessions/s1/attendees`);
  });

  it('ticking attended calls the API and updates the chip', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Παρών: Μαρία Νικολάου' }));
    await waitFor(() => expect(screen.getByTestId('chip-b1')).toHaveTextContent('Παρών'));
    expect(String(posts()[0]![0])).toBe(`/api/gyms/${GYM}/bookings/b1/attendance`);
    expect(JSON.parse(String(posts()[0]![1]!.body))).toEqual({ status: 'attended' });
  });

  it('keeps the old chip and says so when ticking fails', async () => {
    renderPage();
    postStatus = 400;
    await userEvent.click(await screen.findByRole('button', { name: 'Δεν ήρθε: Μαρία Νικολάου' }));
    expect(await screen.findByText('Δεν ήταν δυνατή η καταχώριση. Δοκίμασε ξανά.')).toBeVisible();
    expect(screen.getByTestId('chip-b1')).toHaveTextContent('Κράτηση');
  });

  it('the cancel dialog says how many members are notified; confirming cancels with the reason', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Κρατήσεις' });
    await userEvent.type(screen.getByLabelText(/Λόγος ακύρωσης/), 'Ασθένεια');
    await userEvent.click(screen.getByRole('button', { name: 'Ακύρωση μαθήματος' }));
    const dialog = await screen.findByRole('alertdialog');
    // One of the two is already marked present: only the booked one is told.
    expect(within(dialog).getByText(/Θα ειδοποιηθεί 1 μέλος/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ακύρωση μαθήματος' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(String(posts()[0]![0])).toBe(`/api/gyms/${GYM}/class-sessions/s1/cancel`);
    expect(JSON.parse(String(posts()[0]![1]!.body))).toEqual({ reason: 'Ασθένεια' });
  });

  it('a failed cancel stays in the dialog with an error and does not report a change', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Κρατήσεις' });
    await userEvent.click(screen.getByRole('button', { name: 'Ακύρωση μαθήματος' }));
    postStatus = 500;
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ακύρωση μαθήματος' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('books a member found by name, and explains a full class', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Κρατήσεις' });
    await userEvent.type(screen.getByLabelText('Κράτηση για μέλος'), 'Ελ');
    postStatus = 409;
    await userEvent.click(await screen.findByRole('button', { name: 'Ελένη Δήμου' }));
    expect(await screen.findByText('Το μάθημα είναι πλήρες.')).toBeVisible();
    postStatus = 204;
    await userEvent.click(screen.getByRole('button', { name: 'Ελένη Δήμου' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(String(posts()[1]![1]!.body))).toEqual({ memberId: 'u9' });
  });

  it('without management rights there is no cancel; a cancelled class cannot be ticked or booked', async () => {
    const { unmount } = renderPage({ canManage: false });
    await screen.findByRole('list', { name: 'Κρατήσεις' });
    expect(screen.queryByRole('button', { name: 'Ακύρωση μαθήματος' })).not.toBeInTheDocument();
    unmount();
    renderPage({ session: classSession({ id: 's1', cancelled: true }) });
    await screen.findByRole('list', { name: 'Κρατήσεις' });
    expect(screen.queryByRole('button', { name: /^Παρών: Μαρία/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Κράτηση για μέλος')).not.toBeInTheDocument();
    expect(screen.getByText(/ακυρώθηκε/)).toBeVisible();
  });

  it('changing a weekly class from this day goes through the caller, only for a series', async () => {
    const onChange = vi.fn();
    const { unmount } = renderPage({
      session: classSession({ id: 's1', seriesId: 'series-1' }),
      onChangeFromHere: onChange,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Αλλαγή από αυτή τη μέρα' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
    renderPage({ onChangeFromHere: onChange });
    await screen.findByRole('list', { name: 'Κρατήσεις' });
    expect(screen.queryByRole('button', { name: 'Αλλαγή από αυτή τη μέρα' })).not.toBeInTheDocument();
  });
});
