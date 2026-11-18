import type { ExerciseProgressPoint, Measurement } from '@gym/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { AttendanceChart, ExerciseChart, MeasurementsChart, VolumeChart } from './charts';

// Recharts draws SVG with measured sizes, which jsdom cannot do: a plain stand-in that keeps
// the data and the colours each chart passes in, so what the charts decide can be checked.
vi.mock('recharts', () => {
  const Box =
    (name: string) =>
    ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid={name} data-points={JSON.stringify(data ?? [])}>
        {children}
      </div>
    );
  const Mark = (name: string) => (props: Record<string, unknown>) => (
    <i
      data-testid={name}
      data-key={String(props.dataKey)}
      data-color={String(props.stroke ?? props.fill)}
    />
  );
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LineChart: Box('line-chart'),
    BarChart: Box('bar-chart'),
    Line: Mark('line'),
    Bar: Mark('bar'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

const pt = (
  date: string,
  topSetKg: number,
  e1rmKg: number | null = null,
): ExerciseProgressPoint => ({
  date,
  topSetKg,
  topSetReps: 5,
  e1rmKg,
});

describe('charts', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('el');
  });

  describe('ExerciseChart', () => {
    it('shows the empty state, and no chart, without points', () => {
      render(<ExerciseChart points={[]} weeks={26} name="Πιέσεις στήθους" />);
      expect(screen.getByText('Δεν υπάρχουν ακόμη καταγραφές.')).toBeInTheDocument();
      expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    });

    it('names the first and last top set and the period in a sentence', () => {
      render(
        <ExerciseChart
          points={[pt('2027-03-01', 60, 70), pt('2027-05-10', 70, 82.5)]}
          weeks={13}
          name="Πιέσεις στήθους"
        />,
      );
      expect(screen.getByText('Από 60 σε 70 kg τους τελευταίους 3 μήνες')).toBeInTheDocument();
      // the picture is named by its title; the sentence above it is read once, not twice
      expect(screen.getByRole('img', { name: 'Πιέσεις στήθους' })).toBeInTheDocument();
    });

    it('speaks English with a dot decimal, and "weeks" for a range that is not a whole month choice', async () => {
      await i18n.changeLanguage('en');
      render(
        <ExerciseChart
          points={[pt('2027-03-01', 60.5), pt('2027-05-10', 72.5)]}
          weeks={8}
          name="Bench press"
        />,
      );
      expect(screen.getByText('From 60.5 to 72.5 kg over the last 8 weeks')).toBeInTheDocument();
    });

    it('draws the top set and the e1RM as two lines in two colours, with a legend that is text, not colour', () => {
      render(<ExerciseChart points={[pt('2027-03-01', 60, 70)]} weeks={26} name="Squat" />);
      const lines = screen.getAllByTestId('line');
      expect(lines.map((l) => l.getAttribute('data-key'))).toEqual(['topSetKg', 'e1rmKg']);
      expect(new Set(lines.map((l) => l.getAttribute('data-color'))).size).toBe(2);
      // the chart is fed the points as given, not a reshaped copy
      expect(JSON.parse(screen.getByTestId('line-chart').dataset.points!)).toEqual([
        { date: '2027-03-01', topSetKg: 60, topSetReps: 5, e1rmKg: 70 },
      ]);
      // once in the legend, once as a table header
      expect(screen.getAllByText('Καλύτερο σετ (kg)')).toHaveLength(2);
      expect(screen.getAllByText('Εκτιμώμενο μέγιστο 1RM (kg)')).toHaveLength(2);
    });

    it('offers the same numbers as a table, with a dash where there is no e1RM', async () => {
      const user = userEvent.setup();
      render(<ExerciseChart points={[pt('2027-05-10', 70, null)]} weeks={26} name="Squat" />);
      await user.click(screen.getByText('Πίνακας τιμών'));
      const table = screen.getByRole('table', { name: /Squat/ });
      const cells = within(table)
        .getAllByRole('cell')
        .map((c) => c.textContent);
      expect(cells).toEqual(['70 kg', '5', '–']);
      // the day heads its row, so a screen reader reads "10 May, 70 kg, 5, –"
      expect(within(table).getByRole('rowheader', { name: '10 Μαΐ' })).toBeInTheDocument();
    });
  });

  describe('wording for one', () => {
    it('a first session is a sentence of its own, not "from 100 to 100"', () => {
      render(<ExerciseChart points={[pt('2027-05-10', 100)]} weeks={26} name="Squat" />);
      expect(screen.getByText('100 kg × 5, η μοναδική προπόνηση ως τώρα')).toBeInTheDocument();
      expect(screen.queryByText(/Από 100 σε 100/)).not.toBeInTheDocument();
    });
    it('one visit and one training week use the singular', async () => {
      render(<AttendanceChart points={[{ weekStart: '2027-05-10', days: 1 }]} weeks={52} />);
      expect(screen.getByText('1 επίσκεψη τους τελευταίους 12 μήνες')).toBeInTheDocument();
      render(<VolumeChart points={[{ weekStart: '2027-05-10', volumeKg: 500 }]} weeks={13} />);
      expect(
        screen.getByText('Συνολικά 500 kg σε 1 εβδομάδα με προπόνηση τους τελευταίους 3 μήνες'),
      ).toBeInTheDocument();
      await i18n.changeLanguage('en');
      render(<AttendanceChart points={[{ weekStart: '2027-05-10', days: 1 }]} weeks={26} />);
      expect(screen.getByText('1 visit over the last 6 months')).toBeInTheDocument();
    });
  });

  describe('a chart still waiting for its answer', () => {
    it('shows a placeholder, never "nothing logged yet"', () => {
      render(<ExerciseChart points={[]} loading weeks={26} name="Squat" />);
      expect(screen.getByRole('status')).toHaveTextContent('Φόρτωση…');
      expect(screen.queryByText('Δεν υπάρχουν ακόμη καταγραφές.')).not.toBeInTheDocument();
      render(<VolumeChart points={[]} loading weeks={26} />);
      render(<AttendanceChart points={[]} loading weeks={26} />);
      expect(screen.getAllByRole('status')).toHaveLength(3);
    });
  });

  describe('VolumeChart', () => {
    it('is empty when nothing was lifted, whatever the number of weeks', () => {
      render(<VolumeChart points={[{ weekStart: '2027-05-10', volumeKg: 0 }]} weeks={26} />);
      expect(screen.getByText('Δεν υπάρχουν ακόμη καταγραφές.')).toBeInTheDocument();
    });
    it('sums the weeks into one sentence and passes every week to the bars', () => {
      const points = [
        { weekStart: '2027-05-03', volumeKg: 1200 },
        { weekStart: '2027-05-10', volumeKg: 2300 },
        { weekStart: '2027-05-17', volumeKg: 0 },
      ];
      render(<VolumeChart points={points} weeks={26} />);
      expect(
        screen.getByText('Συνολικά 3.500 kg σε 2 εβδομάδες με προπόνηση τους τελευταίους 6 μήνες'),
      ).toBeInTheDocument();
      expect(JSON.parse(screen.getByTestId('bar-chart').dataset.points!)).toEqual(points);
    });
  });

  describe('AttendanceChart', () => {
    it('averages the visits over the weeks shown', () => {
      render(
        <AttendanceChart
          points={[
            { weekStart: '2027-05-03', days: 3 },
            { weekStart: '2027-05-10', days: 1 },
          ]}
          weeks={52}
        />,
      );
      expect(
        screen.getByText('4 επισκέψεις, κατά μέσο όρο 2 την εβδομάδα τους τελευταίους 12 μήνες'),
      ).toBeInTheDocument();
    });
    it('shows the empty state without any visit', () => {
      render(<AttendanceChart points={[{ weekStart: '2027-05-10', days: 0 }]} weeks={13} />);
      expect(screen.getByText('Δεν υπάρχουν ακόμη καταγραφές.')).toBeInTheDocument();
    });
  });

  describe('MeasurementsChart', () => {
    const m = (
      id: string,
      measuredOn: string,
      weightKg: number | null,
      bodyFatPct: number | null,
    ): Measurement => ({
      id,
      measuredOn,
      weightKg,
      bodyFatPct,
      waistCm: null,
      hipsCm: null,
      chestCm: null,
      armCm: null,
      thighCm: null,
      notes: null,
      recordedBy: null,
    });
    it('draws weight and body fat as two separate charts (never two scales in one), oldest first', () => {
      render(
        <MeasurementsChart
          measurements={[m('b', '2027-05-10', 82, 17.5), m('a', '2027-04-01', 84.5, 19)]}
        />,
      );
      const charts = screen.getAllByTestId('line-chart');
      expect(charts).toHaveLength(2);
      expect(JSON.parse(charts[0]!.dataset.points!)).toEqual([
        { date: '2027-04-01', value: 84.5 },
        { date: '2027-05-10', value: 82 },
      ]);
      expect(JSON.parse(charts[1]!.dataset.points!).map((p: { value: number }) => p.value)).toEqual(
        [19, 17.5],
      );
      expect(screen.getByText('Από 84,5 kg σε 82 kg')).toBeInTheDocument();
      expect(screen.getByText('Από 19 % σε 17,5 %')).toBeInTheDocument();
    });
    it('skips a chart for a value that was never measured', () => {
      render(<MeasurementsChart measurements={[m('a', '2027-04-01', 84.5, null)]} />);
      expect(screen.getAllByTestId('line-chart')).toHaveLength(1);
      expect(screen.queryByText('Λίπος σώματος')).not.toBeInTheDocument();
    });
  });
});
