import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { members } from './fixtures';
import { MembersFlowChart } from './MembersFlowChart';

vi.mock('recharts', async () => (await import('./charts.mock')).rechartsMock());

const sample = () =>
  members({
    '2027-03': { active: 120, new: 10, notRenewed: 6 },
    '2027-04': { active: 128, new: 14, notRenewed: 4, provisional: true },
    '2027-05': { active: 131, new: 9, notRenewed: 3, provisional: true },
  });

describe('MembersFlowChart', () => {
  it('draws the active members as a line and new and not-renewed as bars, on one axis', () => {
    render(<MembersFlowChart members={sample()} />);
    expect(screen.getByTestId('line')).toHaveAttribute('data-key', 'active');
    expect(screen.getAllByTestId('bar').map((b) => b.dataset.key)).toEqual(['new', 'notRenewed']);
  });

  it('fades the bars of months that are not settled yet, and explains why', () => {
    render(<MembersFlowChart members={sample()} />);
    const opacity = screen.getAllByTestId('cell').map((c) => c.dataset.opacity);
    // 12 months per bar series; the provisional ones are April and May: positions 10 and 11 of each.
    expect(opacity).toHaveLength(24);
    const faded = opacity.flatMap((o, i) => (o !== '1' ? [i] : []));
    expect(faded).toEqual([10, 11, 22, 23]);
    expect(screen.getByText(/Οι αχνοί μήνες δεν έχουν κλείσει/)).toBeInTheDocument();
  });

  it('shows no note when every month is settled', () => {
    render(<MembersFlowChart members={members({ '2027-03': { active: 5, new: 1 } })} />);
    expect(screen.queryByText(/Οι αχνοί μήνες/)).not.toBeInTheDocument();
  });

  it('says the active members of this month and last month in words', () => {
    render(<MembersFlowChart members={sample()} />);
    expect(screen.getByText(/Ενεργά μέλη: 131 τον τρέχοντα μήνα/)).toBeInTheDocument();
    expect(screen.getByText(/128 τον προηγούμενο/)).toBeInTheDocument();
  });

  it('the table lists the provisional months as provisional', () => {
    render(<MembersFlowChart members={sample()} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(13);
    expect(within(rows.at(-1)!).getByText('131')).toBeInTheDocument();
    expect(rows.at(-1)).toHaveTextContent('προσωρινό');
    expect(rows.at(-4)).not.toHaveTextContent('προσωρινό'); // February: settled
  });

  it('shows the empty state when nobody was ever a member', () => {
    render(<MembersFlowChart members={members()} />);
    expect(screen.getByText('Δεν υπάρχουν δεδομένα ακόμη.')).toBeInTheDocument();
  });
});
