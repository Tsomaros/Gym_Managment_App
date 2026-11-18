import type { ConsentState, Measurement } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ProgressPage } from './ProgressPage';

vi.mock('recharts', () => {
  const Box =
    (name: string) =>
    ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid={name} data-points={JSON.stringify(data ?? [])}>
        {children}
      </div>
    );
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LineChart: Box('line-chart'),
    BarChart: Box('bar-chart'),
    Line: () => null,
    Bar: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const MEMBER = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';

const granted = (on: boolean): ConsentState => ({
  measurements: { granted: on, at: on ? '2027-05-01T08:00:00.000Z' : null },
  photos: { granted: false, at: null },
});

describe('ProgressPage', () => {
  let urls: string[];
  let consent: ConsentState;
  let measurements: Measurement[];
  let options: unknown[];

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    urls = [];
    consent = granted(false);
    measurements = [];
    options = [
      { exerciseId: BENCH, nameEl: 'Πιέσεις στήθους', nameEn: 'Bench press', sessions: 4 },
      { exerciseId: SQUAT, nameEl: 'Βαθύ κάθισμα', nameEn: 'Squat', sessions: 2 },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input).replace(`/api/gyms/${GYM}`, '');
        urls.push(url);
        if (url.endsWith('/progress/exercises')) return json(200, options);
        const one = /\/progress\/exercises\/([^?]+)\?weeks=(\d+)/.exec(url);
        if (one) {
          return json(200, {
            exerciseId: one[1],
            points:
              one[1] === BENCH
                ? [
                    { date: '2027-03-01', topSetKg: 60, topSetReps: 5, e1rmKg: 70 },
                    { date: '2027-05-10', topSetKg: 70, topSetReps: 5, e1rmKg: 81.5 },
                  ]
                : [{ date: '2027-05-10', topSetKg: 100, topSetReps: 3, e1rmKg: 110 }],
          });
        }
        if (url.includes('/progress/volume'))
          return json(200, [{ weekStart: '2027-05-10', volumeKg: 2300 }]);
        if (url.includes('/progress/attendance'))
          return json(200, [{ weekStart: '2027-05-10', days: 3 }]);
        if (url.endsWith('/consents')) return json(200, consent);
        if (url.endsWith('/measurements')) return json(200, measurements);
        return json(404, {});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = (memberId?: string) =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/progress`]}>
        <Routes>
          <Route path="/g/:gymId/*" element={<ProgressPage memberId={memberId} />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the first exercise, the weekly volume and the attendance for the member’s own /me data', async () => {
    renderPage();
    expect(
      await screen.findByText('Από 60 σε 70 κιλά τους τελευταίους 6 μήνες'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Εβδομαδιαίος όγκος' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Επισκέψεις ανά εβδομάδα' })).toBeInTheDocument();
    expect(urls.every((u) => u.startsWith('/me/'))).toBe(true);
    expect(urls).toContain(`/me/progress/exercises/${BENCH}?weeks=26`);
    expect(urls).toContain('/me/progress/volume?weeks=26');
  });

  it('a trainer asks for the client’s own routes', async () => {
    renderPage(MEMBER);
    await screen.findByText('Από 60 σε 70 κιλά τους τελευταίους 6 μήνες');
    expect(urls.every((u) => u.startsWith(`/members/${MEMBER}/`))).toBe(true);
  });

  it('changing the exercise fetches that exercise and replaces the chart', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Από 60 σε 70 κιλά τους τελευταίους 6 μήνες');
    await user.selectOptions(screen.getByLabelText('Άσκηση'), SQUAT);
    expect(
      await screen.findByText('Από 100 σε 100 κιλά τους τελευταίους 6 μήνες'),
    ).toBeInTheDocument();
    expect(urls).toContain(`/me/progress/exercises/${SQUAT}?weeks=26`);
    expect(screen.getByRole('heading', { name: 'Βαθύ κάθισμα' })).toBeInTheDocument();
  });

  it('the range switch sends weeks=52 to every chart and keeps the exercise', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Από 60 σε 70 κιλά τους τελευταίους 6 μήνες');
    await user.click(screen.getByRole('button', { name: '12 μήνες' }));
    await waitFor(() => expect(urls).toContain(`/me/progress/exercises/${BENCH}?weeks=52`));
    expect(urls).toContain('/me/progress/volume?weeks=52');
    expect(urls).toContain('/me/progress/attendance?weeks=52');
    expect(
      await screen.findByText('Από 60 σε 70 κιλά τους τελευταίους 12 μήνες'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12 μήνες' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '6 μήνες' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('without any logged exercise shows empty states and no exercise picker', async () => {
    options = [];
    renderPage();
    await screen.findByRole('heading', { name: 'Εβδομαδιαίος όγκος' });
    expect(screen.queryByLabelText('Άσκηση')).not.toBeInTheDocument();
    expect(screen.getAllByText('Δεν υπάρχουν ακόμη καταγραφές.').length).toBeGreaterThanOrEqual(1);
    expect(urls.some((u) => /progress\/exercises\/[0-9a-f]/.test(u))).toBe(false);
  });

  it('hides the body measurements without consent, even when rows exist', async () => {
    measurements = [
      {
        id: 'a',
        measuredOn: '2027-05-10',
        weightKg: 80,
        bodyFatPct: 18,
        waistCm: null,
        hipsCm: null,
        chestCm: null,
        armCm: null,
        thighCm: null,
        notes: null,
        recordedBy: null,
      },
    ];
    renderPage();
    await screen.findByRole('heading', { name: 'Εβδομαδιαίος όγκος' });
    expect(screen.queryByRole('heading', { name: 'Βάρος σώματος' })).not.toBeInTheDocument();
    expect(urls.some((u) => u.endsWith('/measurements'))).toBe(false); // not even asked for
  });

  it('shows weight and body fat with consent and data', async () => {
    consent = granted(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-05-12T09:00:00Z'));
    measurements = [
      {
        id: 'a',
        measuredOn: '2027-05-10',
        weightKg: 80,
        bodyFatPct: 18,
        waistCm: null,
        hipsCm: null,
        chestCm: null,
        armCm: null,
        thighCm: null,
        notes: null,
        recordedBy: null,
      },
    ];
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Βάρος σώματος' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Λίπος σώματος' })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('with consent but no measurements the section stays away', async () => {
    consent = granted(true);
    renderPage();
    await screen.findByRole('heading', { name: 'Εβδομαδιαίος όγκος' });
    expect(screen.queryByRole('heading', { name: 'Βάρος σώματος' })).not.toBeInTheDocument();
  });

  it('says so and offers a retry when the server fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json(500, {})),
    );
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Δοκίμασε ξανά' })).toBeInTheDocument();
  });
});
