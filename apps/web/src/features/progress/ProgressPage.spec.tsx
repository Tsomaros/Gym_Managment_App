import type { ConsentState, Measurement } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
    expect(await screen.findByText('Από 60 σε 70 kg τους τελευταίους 6 μήνες')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Επισκέψεις ανά εβδομάδα' })).toBeInTheDocument();
    expect(urls.every((u) => u.startsWith('/me/'))).toBe(true);
    expect(urls).toContain(`/me/progress/exercises/${BENCH}?weeks=26`);
    expect(urls).toContain('/me/progress/volume?weeks=26');
  });

  it('a trainer asks for the client’s own routes', async () => {
    renderPage(MEMBER);
    await screen.findByText('Από 60 σε 70 kg τους τελευταίους 6 μήνες');
    expect(urls.every((u) => u.startsWith(`/members/${MEMBER}/`))).toBe(true);
  });

  it('changing the exercise fetches that exercise and replaces the chart', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Από 60 σε 70 kg τους τελευταίους 6 μήνες');
    await user.selectOptions(screen.getByLabelText('Άσκηση'), SQUAT);
    expect(await screen.findByText('100 kg × 3, η μοναδική προπόνηση ως τώρα')).toBeInTheDocument();
    expect(urls).toContain(`/me/progress/exercises/${SQUAT}?weeks=26`);
    expect(screen.getByRole('heading', { name: 'Βαθύ κάθισμα' })).toBeInTheDocument();
  });

  it('the range switch sends weeks=52 to every chart and keeps the exercise', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Από 60 σε 70 kg τους τελευταίους 6 μήνες');
    await user.click(screen.getByRole('button', { name: '12 μήνες' }));
    await waitFor(() => expect(urls).toContain(`/me/progress/exercises/${BENCH}?weeks=52`));
    expect(urls).toContain('/me/progress/volume?weeks=52');
    expect(urls).toContain('/me/progress/attendance?weeks=52');
    expect(
      await screen.findByText('Από 60 σε 70 kg τους τελευταίους 12 μήνες'),
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

  it('without any logged exercise there is no exercise picker and no exercise chart at all', async () => {
    options = [];
    renderPage();
    await screen.findByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' });
    expect(screen.queryByLabelText('Άσκηση')).not.toBeInTheDocument();
    // not even an empty card with a blank title; volume and attendance (with data) still show
    expect(screen.queryByText('Δεν υπάρχουν ακόμη καταγραφές.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Επισκέψεις ανά εβδομάδα' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).every((h) => h.textContent !== '')).toBe(
      true,
    );
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
    await screen.findByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' });
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
  });

  it('draws only the measurements inside the chosen range', async () => {
    consent = granted(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-05-12T09:00:00Z'));
    const row = (id: string, measuredOn: string, weightKg: number): Measurement => ({
      id,
      measuredOn,
      weightKg,
      bodyFatPct: null,
      waistCm: null,
      hipsCm: null,
      chestCm: null,
      armCm: null,
      thighCm: null,
      notes: null,
      recordedBy: null,
    });
    // 26 weeks before 2027-05-12 is 2026-11-12: the January 2026 row is far outside it
    measurements = [row('old', '2026-01-05', 95), row('new', '2027-05-10', 80)];
    renderPage();
    await screen.findByRole('heading', { name: 'Βάρος σώματος' });
    const weight = screen.getAllByTestId('line-chart').at(-1)!;
    expect(JSON.parse(weight.dataset.points!)).toEqual([{ date: '2027-05-10', value: 80 }]);
  });

  it('the late answer for an older exercise never replaces the newer one', async () => {
    const user = userEvent.setup();
    const answer = fetch as unknown as typeof fetch;
    const gates = new Map<string, () => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (/\/progress\/exercises\/[^?]+\?/.test(url)) {
          const res = await answer(input, init); // build the answer now, deliver it when released
          const id = /exercises\/([^?]+)\?/.exec(url)![1]!;
          await new Promise<void>((resolve) => gates.set(id, resolve));
          return res;
        }
        return answer(input, init);
      }),
    );
    renderPage();
    await screen.findByLabelText('Άσκηση');
    await waitFor(() => expect(gates.has(BENCH)).toBe(true)); // bench is still in flight
    await user.selectOptions(screen.getByLabelText('Άσκηση'), SQUAT);
    await waitFor(() => expect(gates.has(SQUAT)).toBe(true));
    gates.get(SQUAT)!();
    expect(await screen.findByText('100 kg × 3, η μοναδική προπόνηση ως τώρα')).toBeInTheDocument();
    gates.get(BENCH)!(); // the older request lands last
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.getByText('100 kg × 3, η μοναδική προπόνηση ως τώρα')).toBeInTheDocument();
    expect(screen.queryByText(/Από 60 σε 70/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Βαθύ κάθισμα' })).toBeInTheDocument();
  });

  it('retry asks again and the charts come back after a failure', async () => {
    const user = userEvent.setup();
    const answer = fetch as unknown as typeof fetch;
    let broken = true;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => (broken ? json(500, {}) : answer(input, init))),
    );
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(
      screen.queryByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' }),
    ).not.toBeInTheDocument();
    broken = false;
    await user.click(within(alert).getByRole('button', { name: 'Δοκίμασε ξανά' }));
    expect(await screen.findByText('Από 60 σε 70 kg τους τελευταίους 6 μήνες')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a trainer without access to the client gets the error and no chart', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        asked.push(String(input).replace(`/api/gyms/${GYM}`, ''));
        return json(404, { message: 'Not Found' });
      }),
    );
    renderPage(MEMBER);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((u) => u.startsWith(`/members/${MEMBER}/`))).toBe(true);
    expect(
      screen.queryByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Επισκέψεις ανά εβδομάδα' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Άσκηση')).not.toBeInTheDocument();
  });

  it('with consent but no measurements the section stays away', async () => {
    consent = granted(true);
    renderPage();
    await screen.findByRole('heading', { name: 'Εβδομαδιαίος όγκος (kg)' });
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
