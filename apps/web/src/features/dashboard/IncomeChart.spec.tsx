import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { CHART } from '../progress/chartTheme';
import { income } from './fixtures';
import { IncomeChart } from './IncomeChart';

vi.mock('recharts', async () => (await import('./charts.mock')).rechartsMock());

const sample = () =>
  income({
    '2027-04': {
      totalCents: 9000,
      byMethod: { cash: 6000, card: 3000 },
      byType: [
        { name: 'Μηνιαία', cents: 6000 },
        { name: 'Ετήσια', cents: 3000 },
      ],
    },
    '2027-05': {
      totalCents: 12500,
      byMethod: { cash: 4000, card: 8500 },
      byType: [
        { name: 'Μηνιαία', cents: 8000 },
        { name: 'Πακέτο 10', cents: 4500 },
      ],
    },
  });

describe('IncomeChart', () => {
  it('stacks cash and card by default, in the two fixed series colours', () => {
    render(<IncomeChart income={sample()} />);
    const bars = screen.getAllByTestId('bar');
    expect(bars.map((b) => b.dataset.key)).toEqual(['cash', 'card']);
    expect(bars.map((b) => b.dataset.color)).toEqual([CHART.series1, CHART.series2]);
    expect(new Set(bars.map((b) => b.dataset.stack)).size).toBe(1);
    expect(screen.getByRole('button', { name: 'Ανά τρόπο πληρωμής' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('feeds the chart euros, not cents, for the current month', () => {
    render(<IncomeChart income={sample()} />);
    const points = JSON.parse(screen.getByTestId('bar-chart').dataset.points!) as Record<
      string,
      unknown
    >[];
    expect(points).toHaveLength(12);
    expect(points.at(-1)).toMatchObject({ cash: 40, card: 85 }); // 4000 and 8500 cents
    expect(points.at(-2)).toMatchObject({ cash: 60, card: 30 });
  });

  it('says in words what this month and last month earned, with the amounts in euros', () => {
    render(<IncomeChart income={sample()} />);
    expect(screen.getByText(/125,00 € στον τρέχοντα μήνα/)).toBeInTheDocument();
    expect(screen.getByText(/90,00 € τον προηγούμενο/)).toBeInTheDocument();
  });

  it('the toggle switches to one stacked bar per membership type', async () => {
    render(<IncomeChart income={sample()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ανά τύπο συνδρομής' }));
    const bars = screen.getAllByTestId('bar');
    // Biggest type first.
    expect(bars.map((b) => b.dataset.name)).toEqual(['Μηνιαία', 'Πακέτο 10', 'Ετήσια']);
    expect(new Set(bars.map((b) => b.dataset.color)).size).toBe(3);
    expect(screen.getByRole('button', { name: 'Ανά τύπο συνδρομής' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('with more than eight types the smallest fold into "Other"', async () => {
    const types = Array.from({ length: 10 }, (_, i) => ({ name: `T${i}`, cents: 1000 - i * 10 }));
    render(
      <IncomeChart
        income={income({
          '2027-05': { totalCents: 9000, byMethod: { cash: 9000, card: 0 }, byType: types },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ανά τύπο συνδρομής' }));
    const keys = screen.getAllByTestId('bar').map((b) => b.dataset.name);
    expect(keys).toHaveLength(9);
    expect(keys.at(-1)).toBe('Άλλες');
    expect(keys).not.toContain('T9');
    // Folded types are summed into the "Other" bar: T8 (920) + T9 (910) = 1830 cents.
    const points = JSON.parse(screen.getByTestId('bar-chart').dataset.points!) as Record<
      string,
      number
    >[];
    const valueOf = (name: string) => {
      const bar = screen.getAllByTestId('bar').find((b) => b.dataset.name === name)!;
      return points.at(-1)![bar.dataset.key!];
    };
    expect(valueOf('Άλλες')).toBe(18.3);
    expect(valueOf('T0')).toBe(10);
  });

  it('the table has every month, marks the current one, and sums cash and card', () => {
    render(<IncomeChart income={sample()} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(13); // header + 12 months
    const last = rows.at(-1)!;
    expect(last).toHaveTextContent('τρέχων μήνας');
    expect(within(last).getByText('125,00 €')).toBeInTheDocument();
    expect(within(last).getByText('40,00 €')).toBeInTheDocument();
    expect(within(last).getByText('85,00 €')).toBeInTheDocument();
  });

  it('with no money in the whole range it shows the empty state instead of 12 empty bars', () => {
    render(<IncomeChart income={income()} />);
    expect(screen.getByText('Δεν υπάρχουν δεδομένα ακόμη.')).toBeInTheDocument();
    expect(screen.queryByTestId('bar')).not.toBeInTheDocument();
  });

  it('a membership type named like a chart field or like "Other" cannot break the chart', async () => {
    const types = [
      { name: 'label', cents: 900 },
      { name: 'Άλλες', cents: 800 },
      ...Array.from({ length: 7 }, (_, i) => ({ name: `T${i}`, cents: 700 - i * 10 })),
      { name: 'T8', cents: 10 },
    ];
    render(
      <IncomeChart
        income={income({
          '2027-05': { totalCents: 5000, byMethod: { cash: 5000, card: 0 }, byType: types },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ανά τύπο συνδρομής' }));
    const bars = screen.getAllByTestId('bar');
    expect(new Set(bars.map((b) => b.dataset.key)).size).toBe(bars.length);
    const row = JSON.parse(screen.getByTestId('bar-chart').dataset.points!).at(-1);
    // The month's x-axis label is still the month, not the type called "label".
    expect(row.label).toBe('Μαΐ');
    // Folded: only T8 (10 cents, the 9th type); the real type "Άλλες" keeps its own colour.
    const grey = bars.filter((b) => b.dataset.color === '#8b8a84');
    expect(grey).toHaveLength(1);
  });
});
