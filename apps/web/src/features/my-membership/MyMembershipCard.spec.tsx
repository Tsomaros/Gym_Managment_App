import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { membership } from '../../test/fixtures';
import { MyMembershipCard } from './MyMembershipCard';

describe('MyMembershipCard', () => {
  it('shows the days left large, with the name and end date', () => {
    render(
      <MyMembershipCard memberships={[membership({ remaining: { days: 3, visits: null } })]} />,
    );
    expect(screen.getByText('Μηνιαία')).toBeInTheDocument();
    expect(screen.getByText('3 ημέρες')).toBeInTheDocument();
    expect(screen.getByText(/31\/5\/2027/)).toBeInTheDocument();
  });

  it('shows visits left for a visit pack', () => {
    const pack = membership({
      name: 'Δεκάρα',
      kind: 'visits',
      endsOn: null,
      effectiveEndsOn: null,
      visitsTotal: 10,
      visitsUsed: 4,
      remaining: { days: null, visits: 6 },
    });
    render(<MyMembershipCard memberships={[pack]} />);
    expect(screen.getByText('6 επισκέψεις')).toBeInTheDocument();
  });

  it('shows the frozen state with the new end date', () => {
    render(
      <MyMembershipCard
        memberships={[
          membership({
            status: 'frozen',
            effectiveEndsOn: '2027-06-07',
            remaining: { days: 27, visits: null },
          }),
        ]}
      />,
    );
    expect(screen.getByText('Σε πάγωμα')).toBeInTheDocument();
    expect(screen.getByText(/7\/6\/2027/)).toBeInTheDocument();
  });

  it('shows the next membership when one is booked after the current', () => {
    render(
      <MyMembershipCard
        memberships={[
          membership({
            id: 'n',
            status: 'upcoming',
            startsOn: '2027-06-01',
            endsOn: '2027-06-30',
            effectiveEndsOn: '2027-06-30',
          }),
          membership(),
        ]}
      />,
    );
    expect(screen.getByText(/Επόμενη: Μηνιαία από 1\/6\/2027/)).toBeInTheDocument();
  });

  it('says there is no active membership when everything expired', () => {
    render(
      <MyMembershipCard
        memberships={[membership({ status: 'expired', remaining: { days: 0, visits: null } })]}
      />,
    );
    expect(screen.getByText('Δεν έχεις ενεργή συνδρομή.')).toBeInTheDocument();
  });

  it('says there is no active membership when there are none', () => {
    render(<MyMembershipCard memberships={[]} />);
    expect(screen.getByText('Δεν έχεις ενεργή συνδρομή.')).toBeInTheDocument();
  });
});
