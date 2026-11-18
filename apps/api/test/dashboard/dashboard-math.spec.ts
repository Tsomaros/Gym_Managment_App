import { describe, expect, it } from 'vitest';
import {
  busyHours,
  incomeByMonth,
  lastMonths,
  memberFlow,
  monthOf,
  type FlowMembership,
} from '../../src/dashboard/dashboard-math';

const TZ = 'Europe/Athens';

describe('lastMonths', () => {
  it('lists 12 months oldest first, ending with the current one', () => {
    const months = lastMonths('2027-05-15', 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-06');
    expect(months[11]).toBe('2027-05');
  });

  it('crosses a year boundary and handles the first day of a month', () => {
    expect(lastMonths('2027-01-01', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('monthOf (gym time)', () => {
  it('23:30 on 31 January in Athens (21:30 UTC) is still January', () => {
    expect(monthOf(new Date('2027-01-31T21:30:00Z'), TZ)).toBe('2027-01');
  });

  it('00:30 on 1 February in Athens (22:30 UTC on 31 January) is February', () => {
    expect(monthOf(new Date('2027-01-31T22:30:00Z'), TZ)).toBe('2027-02');
  });

  it('the same instant is another month in another time zone', () => {
    expect(monthOf(new Date('2027-01-31T21:30:00Z'), 'Asia/Tokyo')).toBe('2027-02');
  });
});

describe('incomeByMonth', () => {
  const pay = (
    iso: string,
    amountCents: number,
    method: 'cash' | 'card',
    typeName: string,
    voided = false,
  ) => ({ paidAt: new Date(iso), amountCents, method, typeName, voided });
  const months = ['2026-12', '2027-01', '2027-02'];

  it('puts a 23:30 payment of 31 January into January, and adds cash and card separately', () => {
    const rows = incomeByMonth(
      [
        pay('2027-01-31T21:30:00Z', 4000, 'cash', 'Μηνιαία'),
        pay('2027-01-10T10:00:00Z', 2500, 'card', 'Μηνιαία'),
      ],
      months,
      TZ,
    );
    const jan = rows.find((r) => r.month === '2027-01')!;
    expect(jan.totalCents).toBe(6500);
    expect(jan.byMethod).toEqual({ cash: 4000, card: 2500 });
    expect(rows.find((r) => r.month === '2027-02')!.totalCents).toBe(0);
  });

  it('a payment just after midnight in Athens counts in the next month', () => {
    const rows = incomeByMonth([pay('2027-01-31T22:30:00Z', 1000, 'cash', 'A')], months, TZ);
    expect(rows.find((r) => r.month === '2027-01')!.totalCents).toBe(0);
    expect(rows.find((r) => r.month === '2027-02')!.totalCents).toBe(1000);
  });

  it('a voided payment counts nowhere', () => {
    const rows = incomeByMonth([pay('2027-01-10T10:00:00Z', 4000, 'cash', 'A', true)], months, TZ);
    expect(rows.map((r) => r.totalCents)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.byType.length === 0)).toBe(true);
  });

  it('splits by membership type name, biggest first, and ignores months outside the range', () => {
    const rows = incomeByMonth(
      [
        pay('2027-01-05T10:00:00Z', 3000, 'cash', 'Μηνιαία'),
        pay('2027-01-06T10:00:00Z', 5000, 'card', 'Ετήσια'),
        pay('2027-01-07T10:00:00Z', 3000, 'card', 'Μηνιαία'),
        pay('2026-01-07T10:00:00Z', 9999, 'card', 'Παλιά'),
      ],
      months,
      TZ,
    );
    expect(rows.find((r) => r.month === '2027-01')!.byType).toEqual([
      { name: 'Μηνιαία', cents: 6000 },
      { name: 'Ετήσια', cents: 5000 },
    ]);
    expect(rows.reduce((s, r) => s + r.totalCents, 0)).toBe(11000);
  });
});

describe('memberFlow', () => {
  let n = 0;
  const m = (over: Partial<FlowMembership> & { memberId: string }): FlowMembership => ({
    id: `m${++n}`,
    kind: 'time',
    startsOn: '2027-01-01',
    effectiveEndsOn: '2027-12-31',
    voided: false,
    ...over,
  });
  const flow = (ms: FlowMembership[], today: string, months: string[]) =>
    memberFlow(ms, months, today);

  it('a member whose first membership started on 10 February is new in February only', () => {
    const rows = flow([m({ memberId: 'a', startsOn: '2027-02-10' })], '2027-04-15', [
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    expect(rows.map((r) => r.new)).toEqual([0, 1, 0]);
  });

  it('a returning member is not "new" again, and a voided first membership does not make them new', () => {
    const rows = flow(
      [
        m({ memberId: 'a', startsOn: '2027-01-05', effectiveEndsOn: '2027-01-31' }),
        m({ memberId: 'a', startsOn: '2027-03-05', effectiveEndsOn: '2027-03-31' }),
        m({ memberId: 'b', startsOn: '2027-01-02', voided: true }),
        m({ memberId: 'b', startsOn: '2027-03-02', effectiveEndsOn: '2027-03-31' }),
      ],
      '2027-04-15',
      ['2027-01', '2027-02', '2027-03'],
    );
    expect(rows.map((r) => r.new)).toEqual([1, 0, 1]);
  });

  it('active on the last day of the month, frozen members included (their end already moved)', () => {
    const rows = flow(
      [
        m({ memberId: 'a', startsOn: '2027-01-10', effectiveEndsOn: '2027-02-09' }),
        m({ memberId: 'b', startsOn: '2027-02-01', effectiveEndsOn: '2027-02-28' }),
        m({ memberId: 'c', startsOn: '2027-01-01', effectiveEndsOn: '2027-01-30' }),
      ],
      '2027-03-20',
      ['2027-01', '2027-02'],
    );
    // 31 Jan: a and not c (ended 30 Jan). 28 Feb: b only (a ended 9 Feb).
    expect(rows.map((r) => r.active)).toEqual([1, 1]);
  });

  it('the current month is evaluated on today, not on its last day', () => {
    const rows = flow(
      [m({ memberId: 'a', startsOn: '2027-03-01', effectiveEndsOn: '2027-03-20' })],
      '2027-03-25',
      ['2027-03'],
    );
    expect(rows[0]!.active).toBe(0);
    const rows2 = flow(
      [m({ memberId: 'a', startsOn: '2027-03-01', effectiveEndsOn: '2027-03-30' })],
      '2027-03-25',
      ['2027-03'],
    );
    expect(rows2[0]!.active).toBe(1);
  });

  it('a member with two overlapping memberships is counted once, a voided one never', () => {
    const rows = flow(
      [
        m({ memberId: 'a', startsOn: '2027-01-01', effectiveEndsOn: '2027-12-31' }),
        m({ memberId: 'a', startsOn: '2027-01-01', effectiveEndsOn: '2027-12-31' }),
        m({ memberId: 'b', startsOn: '2027-01-01', voided: true }),
      ],
      '2027-06-15',
      ['2027-02'],
    );
    expect(rows[0]!.active).toBe(1);
  });

  it('ended 20 March: renewed 1 April (12 days later) is kept, 10 April (21 days later) is not renewed', () => {
    const base = m({ memberId: 'a', startsOn: '2027-02-20', effectiveEndsOn: '2027-03-20' });
    const kept = flow(
      [base, m({ memberId: 'a', startsOn: '2027-04-01', effectiveEndsOn: '2027-04-30' })],
      '2027-06-30',
      ['2027-03'],
    );
    expect(kept[0]!.notRenewed).toBe(0);
    const lost = flow(
      [base, m({ memberId: 'a', startsOn: '2027-04-10', effectiveEndsOn: '2027-04-30' })],
      '2027-06-30',
      ['2027-03'],
    );
    expect(lost[0]!.notRenewed).toBe(1);
  });

  it('the 14-day renewal window is inclusive: ended 20 March, a start on 3 April renews, 4 April does not', () => {
    // 20 March + 14 days = 3 April.
    const base = m({ memberId: 'a', startsOn: '2027-02-20', effectiveEndsOn: '2027-03-20' });
    const onLimit = flow(
      [base, m({ memberId: 'a', startsOn: '2027-04-03', effectiveEndsOn: '2027-05-03' })],
      '2027-06-30',
      ['2027-03'],
    );
    expect(onLimit[0]!.notRenewed).toBe(0);
    const dayLate = flow(
      [base, m({ memberId: 'a', startsOn: '2027-04-04', effectiveEndsOn: '2027-05-04' })],
      '2027-06-30',
      ['2027-03'],
    );
    expect(dayLate[0]!.notRenewed).toBe(1);
  });

  it('a membership ending exactly on the last day of a month is still active that day, and one ending the day before is not', () => {
    const rows = flow(
      [
        m({ memberId: 'a', startsOn: '2027-01-01', effectiveEndsOn: '2027-01-31' }),
        m({ memberId: 'b', startsOn: '2027-01-01', effectiveEndsOn: '2027-01-30' }),
      ],
      '2027-03-20',
      ['2027-01'],
    );
    expect(rows[0]!.active).toBe(1);
  });

  it('a renewal bought early (starting the day after the end) or one that overlaps counts as renewed', () => {
    const base = m({ memberId: 'a', startsOn: '2027-02-20', effectiveEndsOn: '2027-03-20' });
    const early = m({ memberId: 'a', startsOn: '2027-03-21', effectiveEndsOn: '2027-04-20' });
    const overlap = m({ memberId: 'b', startsOn: '2027-02-20', effectiveEndsOn: '2027-03-20' });
    const overlapNext = m({ memberId: 'b', startsOn: '2027-03-10', effectiveEndsOn: '2027-05-10' });
    const rows = flow([base, early, overlap, overlapNext], '2027-06-30', ['2027-03']);
    expect(rows[0]!.notRenewed).toBe(0);
  });

  it('a voided follow-up membership does not count as a renewal', () => {
    const rows = flow(
      [
        m({ memberId: 'a', startsOn: '2027-02-20', effectiveEndsOn: '2027-03-20' }),
        m({ memberId: 'a', startsOn: '2027-03-21', effectiveEndsOn: '2027-04-20', voided: true }),
      ],
      '2027-06-30',
      ['2027-03'],
    );
    expect(rows[0]!.notRenewed).toBe(1);
  });

  it('only time-based memberships can fail to renew (a visit pack or day pass ending is not churn)', () => {
    const rows = flow(
      [
        m({ memberId: 'a', kind: 'visits', startsOn: '2027-02-20', effectiveEndsOn: '2027-03-20' }),
        m({
          memberId: 'b',
          kind: 'day_pass',
          startsOn: '2027-03-05',
          effectiveEndsOn: '2027-03-05',
        }),
      ],
      '2027-06-30',
      ['2027-03'],
    );
    expect(rows[0]!.notRenewed).toBe(0);
  });

  it('a member is counted once per month even when two memberships ended in it', () => {
    const rows = flow(
      [
        m({ memberId: 'a', startsOn: '2027-02-01', effectiveEndsOn: '2027-03-10' }),
        m({ memberId: 'a', startsOn: '2027-02-05', effectiveEndsOn: '2027-03-12' }),
      ],
      '2027-06-30',
      ['2027-03'],
    );
    expect(rows[0]!.notRenewed).toBe(1);
  });

  it('a month is provisional while it is running, or while its latest end is less than 14 days ago', () => {
    const ends = (end: string) => [
      m({ memberId: 'a', startsOn: '2027-01-01', effectiveEndsOn: end }),
    ];
    // Latest February end 28 Feb: settled on 14 March, provisional the day before.
    expect(flow(ends('2027-02-28'), '2027-03-13', ['2027-02'])[0]!.provisional).toBe(true);
    expect(flow(ends('2027-02-28'), '2027-03-14', ['2027-02'])[0]!.provisional).toBe(false);
    // Latest February end 10 Feb: already settled on 10 March, although the month ended later.
    expect(flow(ends('2027-02-10'), '2027-03-10', ['2027-02'])[0]!.provisional).toBe(false);
    // The month in progress is always provisional, even with no ends yet.
    expect(
      flow([], '2027-03-25', ['2027-01', '2027-02', '2027-03']).map((r) => r.provisional),
    ).toEqual([false, false, true]);
  });

  it('a membership that ends later this month is not a loss yet (nor one ending today)', () => {
    const later = [m({ memberId: 'a', startsOn: '2027-02-01', effectiveEndsOn: '2027-03-28' })];
    expect(flow(later, '2027-03-10', ['2027-03'])[0]!.notRenewed).toBe(0);
    expect(flow(later, '2027-03-28', ['2027-03'])[0]!.notRenewed).toBe(0);
    expect(flow(later, '2027-03-29', ['2027-03'])[0]!.notRenewed).toBe(1);
  });

  it('a visit pack without an end counts as active while it has visits, and only in its first month once used up', () => {
    const rows = flow(
      [
        m({ memberId: 'a', kind: 'visits', startsOn: '2027-01-10', effectiveEndsOn: null }),
        m({
          memberId: 'b',
          kind: 'visits',
          startsOn: '2027-01-10',
          effectiveEndsOn: null,
          exhausted: true,
        }),
      ],
      '2027-04-20',
      ['2027-01', '2027-02', '2027-03'],
    );
    expect(rows.map((r) => r.active)).toEqual([2, 1, 1]);
  });

  it('months before a membership started do not count it', () => {
    const rows = flow([m({ memberId: 'a', startsOn: '2027-03-10' })], '2027-04-20', [
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    expect(rows.map((r) => r.active)).toEqual([0, 0, 1]);
  });
});

describe('busyHours', () => {
  it('a check-in at 00:30 Monday in Athens (21:30 UTC on Sunday) is Monday, hour 0', () => {
    const grid = busyHours([{ at: new Date('2027-03-28T21:30:00Z'), valid: true }], TZ);
    expect(grid[0]![0]).toBe(1);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('is a 7 x 24 grid, Monday first and Sunday last', () => {
    const grid = busyHours([], TZ);
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 24)).toBe(true);
    // 2027-03-28 is a Sunday: 12:00 Athens = 09:00 UTC (summer time from 28 March 03:00 local).
    const sunday = busyHours([{ at: new Date('2027-03-28T09:00:00Z'), valid: true }], TZ);
    expect(sunday[6]![12]).toBe(1);
  });

  it('does not count refused check-ins, and adds up several in one slot', () => {
    const grid = busyHours(
      [
        { at: new Date('2027-03-29T15:05:00Z'), valid: true }, // Monday 18:05
        { at: new Date('2027-03-29T15:50:00Z'), valid: true }, // Monday 18:50
        { at: new Date('2027-03-29T15:20:00Z'), valid: false },
        { at: new Date('2027-04-05T15:10:00Z'), valid: true }, // the next Monday 18:10
      ],
      TZ,
    );
    expect(grid[0]![18]).toBe(3);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });
});
