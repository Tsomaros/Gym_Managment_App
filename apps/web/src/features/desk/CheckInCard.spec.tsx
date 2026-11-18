import { CHECK_IN_REASONS } from '@gym/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { checkInResult, membership } from '../../test/fixtures';
import { CheckInCard } from './CheckInCard';

describe('CheckInCard', () => {
  it('shows a valid check-in in green: photo, full name, status, the membership and what is left', () => {
    render(
      <CheckInCard
        result={checkInResult({
          member: {
            id: 'm',
            firstName: 'Μαρία',
            lastName: 'Νικολάου',
            photoUrl: 'https://files.test/maria.jpg',
          },
          membership: membership({ name: 'Μηνιαία', remaining: { days: 12, visits: null } }),
        })}
      />,
    );
    const card = screen.getByTestId('check-in-card');
    expect(card).toHaveAttribute('data-verdict', 'valid');
    expect(card.className).toMatch(/border-green/);
    expect(within(card).getByRole('img', { name: 'Φωτογραφία: Μαρία Νικολάου' })).toHaveAttribute(
      'src',
      'https://files.test/maria.jpg',
    );
    expect(within(card).getByText('Μαρία Νικολάου')).toBeInTheDocument();
    expect(within(card).getByText(/Έγινε είσοδος/)).toBeInTheDocument();
    expect(within(card).getByText('Ενεργή')).toBeInTheDocument();
    expect(within(card).getByText('Μηνιαία')).toBeInTheDocument();
    expect(within(card).getByText(/12 ημέρες/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Πώληση συνδρομής' })).not.toBeInTheDocument();
  });

  it('names the class a check-in was for, and shows no class line otherwise', () => {
    const { rerender } = render(
      <CheckInCard
        result={checkInResult({
          classBooking: { sessionId: 's1', typeName: 'Spinning', startsAt: '18:00' },
        })}
      />,
    );
    expect(screen.getByTestId('class-line')).toHaveTextContent('Μάθημα: Spinning 18:00');
    rerender(<CheckInCard result={checkInResult({})} />);
    expect(screen.queryByTestId('class-line')).not.toBeInTheDocument();
  });

  it('shows visits left for a pack', () => {
    render(
      <CheckInCard
        result={checkInResult({
          membership: membership({
            kind: 'visits',
            name: 'Δεκάρα',
            effectiveEndsOn: null,
            visitsTotal: 10,
            visitsUsed: 4,
            remaining: { days: null, visits: 6 },
          }),
        })}
      />,
    );
    expect(screen.getByText(/6 επισκέψεις/)).toBeInTheDocument();
  });

  it('shows initials instead of a photo when the member has none', () => {
    render(<CheckInCard result={checkInResult()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('ΓΠ')).toBeInTheDocument();
  });

  it('shows a refusal in a red frame with the reason in words and a button to sell a membership', async () => {
    const onSell = vi.fn();
    const result = checkInResult({
      valid: false,
      reason: 'expired',
      membership: membership({
        status: 'expired',
        effectiveEndsOn: '2027-02-28',
        remaining: { days: 0, visits: null },
      }),
    });
    render(<CheckInCard result={result} onSell={onSell} />);
    const card = screen.getByTestId('check-in-card');
    expect(card).toHaveAttribute('data-verdict', 'refused');
    expect(card.className).toMatch(/border-red/);
    expect(within(card).getByText('Η συνδρομή έληξε στις 28/2/2027')).toBeInTheDocument();
    expect(within(card).getByText(/Δεν επιτρέπεται η είσοδος/)).toBeInTheDocument();
    expect(within(card).queryByText(/Έγινε είσοδος/)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Πώληση συνδρομής' }));
    expect(onSell).toHaveBeenCalledWith(result);
  });

  it.each([
    ['frozen', 'Η συνδρομή είναι σε πάγωμα'],
    ['upcoming_only', 'Η συνδρομή ξεκινά στις 1/6/2027'],
    ['classes_only', 'Έχει μόνο πακέτο μαθημάτων — δεν ανοίγει την είσοδο'],
    ['used_up', 'Οι επισκέψεις εξαντλήθηκαν'],
    ['expired', 'Η συνδρομή έληξε στις 31/5/2027'],
    ['no_membership', 'Δεν έχει συνδρομή'],
  ] as const)('explains %s in words, never by its code', (reason, text) => {
    render(
      <CheckInCard
        result={checkInResult({
          valid: false,
          reason,
          membership:
            reason === 'no_membership'
              ? null
              : membership({ startsOn: '2027-06-01', effectiveEndsOn: '2027-05-31' }),
        })}
      />,
    );
    const card = screen.getByTestId('check-in-card');
    expect(within(card).getByText(text)).toBeInTheDocument();
    expect(card.textContent).not.toContain(reason);
  });

  it('has a distinct text for every refusal reason', () => {
    const texts = CHECK_IN_REASONS.map((reason) => {
      const { unmount } = render(
        <CheckInCard result={checkInResult({ valid: false, reason, membership: membership() })} />,
      );
      const text = screen.getByTestId('check-in-reason').textContent;
      unmount();
      return text;
    });
    expect(new Set(texts).size).toBe(CHECK_IN_REASONS.length);
  });

  it('says a repeat was not recorded again', () => {
    render(<CheckInCard result={checkInResult({ duplicate: true })} />);
    expect(screen.getByText(/δεν καταγράφηκε ξανά/)).toBeInTheDocument();
  });

  it('does not offer to sell when no handler is given', () => {
    render(<CheckInCard result={checkInResult({ valid: false, reason: 'no_membership' })} />);
    expect(screen.queryByRole('button', { name: 'Πώληση συνδρομής' })).not.toBeInTheDocument();
  });

  it('names the primary trainer and, when they are off shift, says so and offers a cover', async () => {
    const onCover = vi.fn();
    const result = checkInResult({
      trainer: { userId: 't1', firstName: 'Νίκος', onDuty: false },
      cover: null,
    });
    render(<CheckInCard result={result} onCover={onCover} />);
    expect(screen.getByText('Γυμναστής: Νίκος (εκτός βάρδιας)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ανάθεση αντικαταστάτη' }));
    expect(onCover).toHaveBeenCalledWith(result);
  });

  it('shows no cover button while the trainer is on shift, and says who covers once assigned', () => {
    const { rerender } = render(
      <CheckInCard
        result={checkInResult({ trainer: { userId: 't1', firstName: 'Νίκος', onDuty: true } })}
        onCover={vi.fn()}
      />,
    );
    expect(screen.getByText('Γυμναστής: Νίκος')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ανάθεση αντικαταστάτη' })).not.toBeInTheDocument();

    rerender(
      <CheckInCard
        result={checkInResult({
          trainer: { userId: 't1', firstName: 'Νίκος', onDuty: false },
          cover: { trainerId: 't2', firstName: 'Ελένη' },
        })}
        onCover={vi.fn()}
      />,
    );
    expect(screen.getByText('Αντικαταστάτης σήμερα: Ελένη')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ανάθεση αντικαταστάτη' })).not.toBeInTheDocument();
  });

  it('shows nothing about trainers for a member without one, and no cover button without a handler', () => {
    const { rerender } = render(<CheckInCard result={checkInResult()} onCover={vi.fn()} />);
    expect(screen.queryByText(/Γυμναστής:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ανάθεση αντικαταστάτη' })).not.toBeInTheDocument();
    rerender(
      <CheckInCard
        result={checkInResult({ trainer: { userId: 't1', firstName: 'Νίκος', onDuty: false } })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ανάθεση αντικαταστάτη' })).not.toBeInTheDocument();
  });
});
