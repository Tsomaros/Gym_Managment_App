import type { Dashboard, DashboardIncomeMonth, DashboardMemberMonth } from '@gym/shared';

export const MONTHS = [
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
  '2027-03',
  '2027-04',
  '2027-05',
];

export const income = (over: Record<string, Partial<DashboardIncomeMonth>> = {}) =>
  MONTHS.map((month): DashboardIncomeMonth => ({
    month,
    totalCents: 0,
    byMethod: { cash: 0, card: 0 },
    byType: [],
    ...over[month],
  }));

export const members = (over: Record<string, Partial<DashboardMemberMonth>> = {}) =>
  MONTHS.map((month): DashboardMemberMonth => ({
    month,
    active: 0,
    new: 0,
    notRenewed: 0,
    provisional: false,
    ...over[month],
  }));

export const emptyGrid = (): number[][] => Array.from({ length: 7 }, () => new Array(24).fill(0));

export const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
  income: income(),
  members: members(),
  busyHours: emptyGrid(),
  today: { visitors: 0, present: 0, expiringSoon: 0 },
  ...over,
});
