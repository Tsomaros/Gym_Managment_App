import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { BusyHoursHeatmap } from './BusyHoursHeatmap';
import { emptyGrid } from './fixtures';

function grid(cells: [day: number, hour: number, n: number][]): number[][] {
  const g = emptyGrid();
  for (const [d, h, n] of cells) g[d]![h] = n;
  return g;
}

describe('BusyHoursHeatmap', () => {
  it('names the busiest slot in the summary, Monday first', () => {
    render(
      <BusyHoursHeatmap
        grid={grid([
          [0, 18, 12],
          [2, 7, 9],
          [6, 11, 3],
          [4, 20, 1],
        ])}
      />,
    );
    expect(screen.getByText(/Δευτέρα 18:00–19:00 \(12\)/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Δευτέρα 18:00–19:00 \(12\), Τετάρτη 07:00–08:00 \(9\), Κυριακή 11:00–12:00 \(3\)/,
      ),
    ).toBeInTheDocument();
    // Only the three busiest are named.
    expect(screen.getByText(/^Πιο πολυσύχναστες ώρες: /)).not.toHaveTextContent('Παρασκευή');
  });

  it('is a table of 7 weekday rows by 24 hours, each cell readable by a screen reader', () => {
    render(<BusyHoursHeatmap grid={grid([[0, 18, 12]])} />);
    const table = screen.getByRole('table', { name: /Πιο πολυσύχναστες ώρες/ });
    expect(within(table).getAllByRole('row')).toHaveLength(8); // hours + 7 days
    expect(within(table).getAllByRole('cell')).toHaveLength(7 * 24);
    expect(
      within(table).getByRole('cell', { name: 'Δευτέρα 18:00–19:00: 12 είσοδοι' }),
    ).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ']);
  });

  it('shades the busy cell darker than a quiet one and leaves an empty cell unshaded', () => {
    render(
      <BusyHoursHeatmap
        grid={grid([
          [0, 18, 12],
          [0, 19, 3],
        ])}
      />,
    );
    const alpha = (name: string) =>
      Number(screen.getByRole('cell', { name }).getAttribute('data-level') ?? Number.NaN);
    const busy = alpha('Δευτέρα 18:00–19:00: 12 είσοδοι');
    const quiet = alpha('Δευτέρα 19:00–20:00: 3 είσοδοι');
    const none = alpha('Δευτέρα 20:00–21:00: 0 είσοδοι');
    expect(busy).toBeGreaterThan(quiet);
    expect(quiet).toBeGreaterThan(none);
    expect(none).toBe(0);
    // The level must reach the colour: busiest = full blue, 3 of 12 = 0.25 + 0.75 * 0.25 = 0.44.
    const paint = (name: string) => screen.getByRole('cell', { name }).getAttribute('style') ?? '';
    expect(paint('Δευτέρα 18:00–19:00: 12 είσοδοι')).toBe('background-color: rgb(42, 120, 214);');
    expect(paint('Δευτέρα 19:00–20:00: 3 είσοδοι')).toContain('rgba(42, 120, 214, 0.44)');
    expect(paint('Δευτέρα 20:00–21:00: 0 είσοδοι')).not.toContain('42, 120, 214');
  });

  it('breaks a tie in favour of the earlier weekday and hour', () => {
    render(
      <BusyHoursHeatmap
        grid={grid([
          [3, 9, 5],
          [1, 17, 5],
        ])}
      />,
    );
    expect(
      screen.getByText(/Τρίτη 17:00–18:00 \(5\), Πέμπτη 09:00–10:00 \(5\)/),
    ).toBeInTheDocument();
  });

  it('with no check-ins at all it says so instead of drawing an empty grid', () => {
    render(<BusyHoursHeatmap grid={emptyGrid()} />);
    expect(screen.getByText('Καμία είσοδος τις τελευταίες 8 εβδομάδες.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Πιο πολυσύχναστες ώρες/ })).not.toBeInTheDocument();
  });

  it('writes the last hour of the day as ending at 24:00, and says "1 check-in" in the singular', () => {
    render(<BusyHoursHeatmap grid={grid([[4, 23, 1]])} />);
    expect(screen.getByText(/Παρασκευή 23:00–24:00 \(1\)/)).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'Παρασκευή 23:00–24:00: 1 είσοδος' }),
    ).toBeInTheDocument();
  });
});
