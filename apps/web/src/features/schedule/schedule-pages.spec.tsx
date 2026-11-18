import type { ExpandedShift, GymSettings, OnDutyPerson, ScheduleResponse } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { MySchedulePage } from './MySchedulePage';
import { OnDutyPanel } from './OnDutyPanel';
import { SchedulePage } from './SchedulePage';

const NIKOS = '2b2b2b2b-2222-4222-8222-222222222222';
// Tuesday 4 May 2027, 10:00 in Athens
const NOW = new Date('2027-05-04T07:00:00Z');

const settings = (over: Partial<GymSettings> = {}): GymSettings => ({
  name: 'Gym',
  timezone: 'Europe/Athens',
  autoCheckoutMinutes: 120,
  receptionCanEditShifts: false,
  reminderDays: 5,
  capacity: null,
  showOccupancyCount: false,
  classCancelCutoffMinutes: 120,
  ...over,
});
const week = (monday: string): ScheduleResponse => ({
  staff: [{ userId: NIKOS, firstName: 'Νίκος', lastName: 'Γυμναστής', roles: ['trainer'] }],
  shifts:
    monday === '2027-05-03'
      ? [
          {
            staffId: NIKOS,
            date: '2027-05-05',
            startsAt: '06:00',
            endsAt: '14:00',
            seriesId: 's1',
            shiftId: null,
            note: null,
          },
        ]
      : [],
});

const inGym = (ui: React.ReactElement, path = 'schedule') =>
  render(
    <MemoryRouter initialEntries={[`/g/${GYM}/${path}`]}>
      <Routes>
        <Route path={`/g/:gymId/${path}`} element={ui} />
      </Routes>
    </MemoryRouter>,
  );

describe('SchedulePage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let current: GymSettings;

  beforeEach(() => {
    current = settings();
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === `/api/gyms/${GYM}/settings`) return json(200, current);
      const m = /\/schedule\?from=([\d-]+)&to=([\d-]+)/.exec(url);
      if (m) return json(200, week(m[1]!));
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const scheduleUrls = () =>
    fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/schedule?'));

  it('shows the current gym week (Monday to Sunday) and moves between weeks', async () => {
    const user = userEvent.setup();
    inGym(<SchedulePage isOwner now={() => NOW} />);
    expect(await screen.findByText('06:00–14:00')).toBeInTheDocument();
    expect(scheduleUrls()).toEqual([`/api/gyms/${GYM}/schedule?from=2027-05-03&to=2027-05-09`]);
    await user.click(screen.getByRole('button', { name: 'Επόμενη εβδομάδα' }));
    await waitFor(() =>
      expect(scheduleUrls().at(-1)).toBe(`/api/gyms/${GYM}/schedule?from=2027-05-10&to=2027-05-16`),
    );
    await user.click(screen.getByRole('button', { name: 'Αυτή η εβδομάδα' }));
    await waitFor(() =>
      expect(scheduleUrls().at(-1)).toBe(`/api/gyms/${GYM}/schedule?from=2027-05-03&to=2027-05-09`),
    );
  });

  it('takes the gym date, not the device date, for "this week" near midnight', async () => {
    // 21:30 UTC on Sunday 9 May is already Monday 10 May in Athens
    inGym(<SchedulePage isOwner now={() => new Date('2027-05-09T21:30:00Z')} />);
    await waitFor(() =>
      expect(scheduleUrls()[0]).toBe(`/api/gyms/${GYM}/schedule?from=2027-05-10&to=2027-05-16`),
    );
  });

  it('lets the owner add to a future cell, and reception only once the owner allowed it', async () => {
    const owner = inGym(<SchedulePage isOwner now={() => NOW} />);
    await screen.findByText('06:00–14:00');
    expect(screen.getAllByRole('button', { name: /Προσθήκη βάρδιας/ }).length).toBeGreaterThan(0);
    owner.unmount();

    const rec = inGym(<SchedulePage isOwner={false} now={() => NOW} />);
    await screen.findByText('06:00–14:00');
    expect(screen.queryByRole('button', { name: /Προσθήκη βάρδιας/ })).not.toBeInTheDocument();
    expect(screen.getByText('Τις βάρδιες τις αλλάζει ο ιδιοκτήτης.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Αλλαγή βάρδιας/ })).not.toBeInTheDocument();
    rec.unmount();

    current = settings({ receptionCanEditShifts: true });
    inGym(<SchedulePage isOwner={false} now={() => NOW} />);
    await screen.findByText('06:00–14:00');
    expect(screen.getAllByRole('button', { name: /Προσθήκη βάρδιας/ }).length).toBeGreaterThan(0);
  });

  it('makes days before the gym date read-only, and today still editable', async () => {
    // 21:30 UTC on Tuesday 4 May is already Wednesday 5 May 00:30 in Athens
    inGym(<SchedulePage isOwner now={() => new Date('2027-05-04T21:30:00Z')} />);
    // Wednesday's shift is today in the gym: still openable
    expect(
      await screen.findByRole('button', { name: /Αλλαγή βάρδιας.*06:00–14:00/ }),
    ).toBeVisible();
    const adds = screen.getAllByRole('button', { name: /Προσθήκη βάρδιας/ });
    expect(adds).toHaveLength(5); // Wednesday to Sunday
    expect(screen.queryByRole('button', { name: /Προσθήκη βάρδιας.*(Δευτέρα|Τρίτη)/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Προσθήκη βάρδιας.*Τετάρτη/ })).toBeInTheDocument();
  });

  it('opens the shift dialog from a block and reloads the week after saving', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT') return json(200, { id: 'x' });
      if (url === `/api/gyms/${GYM}/settings`) return json(200, current);
      const m = /\/schedule\?from=([\d-]+)/.exec(url);
      return m ? json(200, week(m[1]!)) : json(404, {});
    });
    inGym(<SchedulePage isOwner now={() => NOW} />);
    await user.click(await screen.findByRole('button', { name: /Αλλαγή βάρδιας.*06:00–14:00/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Αλλαγή βάρδιας' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Ακύρωση βάρδιας αυτής της μέρας' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Ναι, συνέχεια' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Αποθηκεύτηκε.');
    expect(scheduleUrls()).toEqual([
      `/api/gyms/${GYM}/schedule?from=2027-05-03&to=2027-05-09`,
      `/api/gyms/${GYM}/schedule?from=2027-05-03&to=2027-05-09`,
    ]);
    const puts = fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(String(puts[0]![0])).toBe(`/api/gyms/${GYM}/shift-series/s1/occurrences/2027-05-05`);
    expect(JSON.parse(String(puts[0]![1]!.body))).toEqual({ cancelled: true });
  });

  it('ignores a late answer for a week that is no longer shown', async () => {
    const user = userEvent.setup();
    const pending = new Map<string, (r: Response) => void>();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === `/api/gyms/${GYM}/settings`) return json(200, current);
      const m = /from=([\d-]+)/.exec(url)!;
      if (m[1] === '2027-05-03') return json(200, week('2027-05-03'));
      return new Promise<Response>((resolve) => pending.set(m[1]!, resolve));
    });
    inGym(<SchedulePage isOwner now={() => NOW} />);
    await screen.findByText('06:00–14:00');
    await user.click(screen.getByRole('button', { name: 'Επόμενη εβδομάδα' })); // 10 May
    await user.click(screen.getByRole('button', { name: 'Επόμενη εβδομάδα' })); // 17 May
    await waitFor(() => expect(pending.size).toBe(2));
    // the answers arrive in the wrong order: 17 May first, then the stale 10 May
    pending.get('2027-05-17')!(
      json(200, {
        ...week('x'),
        shifts: [
          {
            ...week('2027-05-03').shifts[0]!,
            date: '2027-05-18',
            startsAt: '07:00',
            endsAt: '09:00',
          },
        ],
      }),
    );
    expect(await screen.findByText('07:00–09:00')).toBeInTheDocument();
    pending.get('2027-05-10')!(
      json(200, {
        ...week('x'),
        shifts: [
          {
            ...week('2027-05-03').shifts[0]!,
            date: '2027-05-11',
            startsAt: '11:00',
            endsAt: '12:00',
          },
        ],
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('11:00–12:00')).not.toBeInTheDocument();
    expect(screen.getByText('07:00–09:00')).toBeInTheDocument();
  });

  it('does not show the old week while the new one loads', async () => {
    const user = userEvent.setup();
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === `/api/gyms/${GYM}/settings`) return json(200, current);
      if (url.includes('from=2027-05-03')) return json(200, week('2027-05-03'));
      return new Promise<Response>((resolve) => (release = resolve));
    });
    inGym(<SchedulePage isOwner now={() => NOW} />);
    await screen.findByText('06:00–14:00');
    await user.click(screen.getByRole('button', { name: 'Επόμενη εβδομάδα' }));
    expect(screen.queryByText('06:00–14:00')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    release(json(200, week('2027-05-10')));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('renders the day list at 375 px', async () => {
    // a 375 px screen matches a max-width query only if its limit is at least 375
    const matches = (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      return !!max && 375 <= Number(max[1]);
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: matches(query),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    inGym(<SchedulePage isOwner now={() => NOW} />);
    expect(await screen.findAllByRole('heading', { level: 3 })).toHaveLength(7);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Αλλαγή βάρδιας.*06:00–14:00/ })).toBeInTheDocument();
  });

  it('renders the table on a wide screen', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    inGym(<SchedulePage isOwner now={() => NOW} />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('says so, with a retry, when the schedule cannot be loaded', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/settings') ? json(200, current) : json(500, {}),
    );
    inGym(<SchedulePage isOwner now={() => NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    const retry = screen.getByRole('button', { name: 'Δοκίμασε ξανά' });

    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/settings') ? json(200, current) : json(200, week('2027-05-03')),
    );
    await userEvent.setup().click(retry);
    expect(await screen.findByText('06:00–14:00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the grid when "this week" is pressed on the week already shown', async () => {
    const user = userEvent.setup();
    inGym(<SchedulePage isOwner now={() => NOW} />);
    await screen.findByText('06:00–14:00');
    await user.click(screen.getByRole('button', { name: 'Αυτή η εβδομάδα' }));
    expect(screen.getByText('06:00–14:00')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('MySchedulePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists the next 14 days of own shifts and marks today', async () => {
    // pin the device zone so "today" is a fixed, hand-written date: 07:00 UTC is 10:00 on 4 May
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Athens',
    } as Intl.ResolvedDateTimeFormatOptions);
    const today = '2027-05-04';
    const shifts: ExpandedShift[] = [
      {
        staffId: NIKOS,
        date: today,
        startsAt: '06:00',
        endsAt: '14:00',
        seriesId: 's',
        shiftId: null,
        note: null,
      },
      {
        staffId: NIKOS,
        date: '2027-05-06',
        startsAt: '09:00',
        endsAt: '12:00',
        seriesId: null,
        shiftId: 'o',
        note: 'Εκπαίδευση',
      },
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, shifts));
    vi.stubGlobal('fetch', fetchMock);
    inGym(<MySchedulePage now={() => NOW} />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-current', 'date');
    expect(within(items[0]!).getByText('06:00–14:00')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/σήμερα/)).toBeInTheDocument();
    expect(items[1]).not.toHaveAttribute('aria-current');
    expect(within(items[1]!).getByText('Εκπαίδευση')).toBeInTheDocument();
    const url = String(fetchMock.mock.calls[0]![0]);
    // 14 days from 4 May inclusive end on 17 May
    expect(url).toBe(`/api/gyms/${GYM}/me/schedule?from=2027-05-04&to=2027-05-17`);
  });

  it('says so when there is nothing to show', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json(200, [])),
    );
    inGym(<MySchedulePage now={() => NOW} />);
    expect(await screen.findByText('Δεν έχεις βάρδιες τις επόμενες 14 μέρες.')).toBeInTheDocument();
  });
});

describe('OnDutyPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists who is on a shift with the end time and asks again after a minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let people: OnDutyPerson[] = [
      {
        userId: NIKOS,
        firstName: 'Νίκος',
        lastName: 'Γυμναστής',
        roles: ['trainer'],
        until: '14:00',
      },
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, people));
    vi.stubGlobal('fetch', fetchMock);
    inGym(<OnDutyPanel />, 'desk');
    expect(await screen.findByText('Νίκος Γυμναστής')).toBeInTheDocument();
    expect(screen.getByText(/Γυμναστής · έως 14:00/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    people = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText('Κανείς δεν είναι σε βάρδια αυτή τη στιγμή.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Νίκος Γυμναστής')).not.toBeInTheDocument();
  });

  it('says so when the first load fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    inGym(<OnDutyPanel />, 'desk');
    expect(await screen.findByText('Δεν φορτώθηκαν οι βάρδιες.')).toBeInTheDocument();
  });

  it('keeps the last list when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = false;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      fail
        ? json(500, {})
        : json(200, [
            {
              userId: NIKOS,
              firstName: 'Νίκος',
              lastName: 'Γυμναστής',
              roles: ['trainer'],
              until: '14:00',
            },
          ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    inGym(<OnDutyPanel />, 'desk');
    expect(await screen.findByText('Νίκος Γυμναστής')).toBeInTheDocument();
    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Νίκος Γυμναστής')).toBeInTheDocument();
    expect(screen.queryByText('Δεν φορτώθηκαν οι βάρδιες.')).not.toBeInTheDocument();
  });

  it('says the list is out of date when a refresh fails after a good load', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        calls += 1;
        return calls === 1
          ? json(200, [
              {
                userId: NIKOS,
                firstName: 'Νίκος',
                lastName: 'Γυμναστής',
                roles: ['trainer'],
                until: '14:00',
              },
            ])
          : json(500, {});
      }),
    );
    inGym(<OnDutyPanel />, 'desk');
    expect(await screen.findByText('Νίκος Γυμναστής')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_500);
    });
    expect(await screen.findByText(/Δεν ανανεώθηκε/)).toBeInTheDocument();
    expect(screen.getByText('Νίκος Γυμναστής')).toBeInTheDocument();
  });
});
