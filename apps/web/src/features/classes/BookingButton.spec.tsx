import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { BookingButton } from './BookingButton';
import { classSession } from './test-data';

describe('BookingButton', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let respond: () => Response;
  const onChanged = vi.fn();

  beforeEach(() => {
    onChanged.mockClear();
    respond = () => json(201, { id: 'b' });
    fetchMock = vi.fn<typeof fetch>(async () => respond());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderButton = (
    session = classSession({ id: 's1', booked: 3, capacity: 12 }),
    canBook = true,
  ) =>
    render(
      <BookingButton
        gymId={GYM}
        session={session}
        canBook={canBook}
        dayLabel="Τετάρτη 12 Μαΐου"
        onChanged={onChanged}
      />,
    );

  it('shows "Κράτηση" for an open class and books it', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Κράτηση/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/class-sessions/s1/bookings`);
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
  });

  it('a booked class shows "Κλεισμένο ✓" and a cancel button, not the book button', () => {
    renderButton(
      classSession({
        myBooking: { id: 'bk', status: 'booked', usesEntry: false, late: false },
      }),
    );
    expect(screen.getByText('Κλεισμένο ✓')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Ακύρωση/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Κράτηση/ })).not.toBeInTheDocument();
  });

  it('a full class is a disabled "Πλήρες"', () => {
    renderButton(classSession({ booked: 12, capacity: 12 }));
    expect(screen.getByRole('button', { name: 'Πλήρες' })).toBeDisabled();
  });

  it('without a membership with classes the button is disabled and says who to ask', () => {
    renderButton(classSession(), false);
    expect(screen.getByRole('button', { name: 'Χρειάζεσαι συνδρομή με μαθήματα' })).toBeDisabled();
    expect(screen.getByText('Ρώτα στη ρεσεψιόν.')).toBeVisible();
  });

  it('a 409 "Class full" turns the card to "Πλήρες"; "No membership" to the membership state', async () => {
    respond = () => json(409, { message: 'Class full' });
    const { unmount } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Κράτηση/ }));
    expect(await screen.findByRole('button', { name: 'Πλήρες' })).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
    unmount();
    respond = () => json(409, { message: 'No membership for classes' });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Κράτηση/ }));
    expect(
      await screen.findByRole('button', { name: 'Χρειάζεσαι συνδρομή με μαθήματα' }),
    ).toBeDisabled();
  });

  it('shows an error and keeps the book button when booking fails for another reason', async () => {
    respond = () => json(500, {});
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Κράτηση/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν ήταν δυνατή η κράτηση');
    expect(screen.getByRole('button', { name: /^Κράτηση/ })).toBeVisible();
  });

  describe('cancelling', () => {
    const booked = (usesEntry: boolean, late: boolean) =>
      classSession({ id: 's1', myBooking: { id: 'bk', status: 'booked', usesEntry, late } });

    it('inside the cut-off, a pack booking warns that an entry is charged', async () => {
      renderButton(booked(true, true));
      await userEvent.click(screen.getByRole('button', { name: /^Ακύρωση/ }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(/χρεώνει μία είσοδο/)).toBeVisible();
    });

    it('no warning for a time membership inside the cut-off, nor for a pack booking outside it', async () => {
      const { unmount } = renderButton(booked(false, true));
      await userEvent.click(screen.getByRole('button', { name: /^Ακύρωση/ }));
      expect(within(await screen.findByRole('alertdialog')).queryByText(/χρεώνει/)).toBeNull();
      unmount();
      renderButton(booked(true, false));
      await userEvent.click(screen.getByRole('button', { name: /^Ακύρωση/ }));
      expect(within(await screen.findByRole('alertdialog')).queryByText(/χρεώνει/)).toBeNull();
    });

    it('confirming deletes the booking and reloads; keeping it changes nothing', async () => {
      respond = () => json(200, { status: 'cancelled' });
      renderButton(booked(false, false));
      await userEvent.click(screen.getByRole('button', { name: /^Ακύρωση/ }));
      await userEvent.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Κράτα την κράτηση',
        }),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: /^Ακύρωση/ }));
      await userEvent.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Ακύρωση κράτησης',
        }),
      );
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/me/bookings/bk`);
      expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE');
    });

    it('a failed cancel says so inside the dialog and reports no change', async () => {
      respond = () => json(500, {});
      renderButton(booked(false, false));
      await userEvent.click(screen.getByRole('button', { name: /^Ακύρωση/ }));
      const dialog = await screen.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Ακύρωση κράτησης' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  it('a cancelled class and an attended booking show text, no buttons', () => {
    const { unmount } = renderButton(classSession({ cancelled: true }));
    expect(screen.getByText('Το μάθημα ακυρώθηκε.')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    renderButton(
      classSession({ myBooking: { id: 'bk', status: 'attended', usesEntry: true, late: false } }),
    );
    expect(screen.getByText('✓ Παρών')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
