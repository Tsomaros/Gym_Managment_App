import type { MembershipKind } from '@gym/shared';
import { addDays, todayIn } from '../memberships/dates';

/** The 14 days a member has, after a time-based membership ends, to buy the next one. */
export const RENEWAL_GRACE_DAYS = 14;

/** The last `n` months up to the one `today` (YYYY-MM-DD) is in, as YYYY-MM, oldest first. */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** The gym-local month (YYYY-MM) of an instant. */
export function monthOf(instant: Date, timezone: string): string {
  return todayIn(timezone, instant).slice(0, 7);
}

const lastDayOf = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export interface IncomePayment {
  paidAt: Date;
  amountCents: number;
  method: 'cash' | 'card';
  /** The membership type's name as sold (a snapshot). */
  typeName: string;
  voided: boolean;
}

export interface IncomeMonth {
  month: string;
  totalCents: number;
  byMethod: { cash: number; card: number };
  byType: { name: string; cents: number }[];
}

/** Money received per gym-local month; voided payments count nowhere. One row per month asked for. */
export function incomeByMonth(
  payments: readonly IncomePayment[],
  months: readonly string[],
  timezone: string,
): IncomeMonth[] {
  const rows = new Map<string, IncomeMonth & { types: Map<string, number> }>(
    months.map((month) => [
      month,
      { month, totalCents: 0, byMethod: { cash: 0, card: 0 }, byType: [], types: new Map() },
    ]),
  );
  for (const p of payments) {
    if (p.voided) continue;
    const row = rows.get(monthOf(p.paidAt, timezone));
    if (!row) continue;
    row.totalCents += p.amountCents;
    row.byMethod[p.method] += p.amountCents;
    row.types.set(p.typeName, (row.types.get(p.typeName) ?? 0) + p.amountCents);
  }
  return months.map((month) => {
    const { types, ...row } = rows.get(month)!;
    row.byType = [...types]
      .map(([name, cents]) => ({ name, cents }))
      .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
    return row;
  });
}

export interface FlowMembership {
  id: string;
  memberId: string;
  kind: MembershipKind;
  startsOn: string;
  /** The effective end (freezes included); null for a visit pack without an expiry. */
  effectiveEndsOn: string | null;
  voided: boolean;
  /** All visits used. Only matters for a pack without an end date. */
  exhausted?: boolean;
}

export interface FlowMonth {
  month: string;
  /** Distinct members with a running (or frozen) membership on the month's last day. */
  active: number;
  /** Members whose first-ever membership started in the month. */
  new: number;
  /** Members whose time-based membership ended in the month with no follow-on within 14 days. */
  notRenewed: number;
  /**
   * True while the numbers may still change: the month is not over, or its latest end is less
   * than 14 days ago (a member can still renew).
   */
  provisional: boolean;
}

/**
 * Members per month. The current month is judged on `today`, earlier ones on their last day.
 * A pack without an end date counts as running while it has visits; a used-up one only in the
 * month it started (the history of when it ran out is not kept).
 */
export function memberFlow(
  memberships: readonly FlowMembership[],
  months: readonly string[],
  today: string,
): FlowMonth[] {
  const live = memberships.filter((m) => !m.voided);
  // Renewal checks only ever look at the same member's memberships: group once, not per month.
  const ofMember = new Map<string, FlowMembership[]>();
  for (const m of live) ofMember.set(m.memberId, [...(ofMember.get(m.memberId) ?? []), m]);
  const firstStart = new Map<string, string>();
  for (const m of live) {
    const first = firstStart.get(m.memberId);
    if (first === undefined || m.startsOn < first) firstStart.set(m.memberId, m.startsOn);
  }

  return months.map((month) => {
    const last = lastDayOf(month);
    const day = last < today ? last : today;

    const active = new Set<string>();
    for (const m of live) {
      if (m.startsOn > day) continue;
      const running =
        m.effectiveEndsOn !== null
          ? day <= m.effectiveEndsOn
          : !m.exhausted || m.startsOn.slice(0, 7) === month;
      if (running) active.add(m.memberId);
    }

    const created = new Set<string>();
    for (const [memberId, start] of firstStart)
      if (start.slice(0, 7) === month) created.add(memberId);

    const lost = new Set<string>();
    // The latest end in the month decides when it is settled: 14 days after it, nobody can renew.
    let lastEnd: string | null = null;
    for (const m of live) {
      const end = m.effectiveEndsOn;
      if (m.kind !== 'time' || end === null || end.slice(0, 7) !== month) continue;
      if (lastEnd === null || end > lastEnd) lastEnd = end;
      // Still running (or ending today): the member may yet renew, so it is not a loss.
      if (end >= today) continue;
      const limit = addDays(end, RENEWAL_GRACE_DAYS);
      const renewed = ofMember
        .get(m.memberId)!
        .some(
          (o) =>
            o.id !== m.id &&
            o.startsOn <= limit &&
            (o.effectiveEndsOn === null || o.effectiveEndsOn > end),
        );
      if (!renewed) lost.add(m.memberId);
    }

    return {
      month,
      active: active.size,
      new: created.size,
      notRenewed: lost.size,
      // A month that has not finished can still gain ends; a finished one settles 14 days after
      // its latest end.
      provisional:
        last >= today || (lastEnd !== null && addDays(lastEnd, RENEWAL_GRACE_DAYS) > today),
    };
  });
}

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Valid check-ins counted by weekday (Monday = row 0) and gym-local hour (0-23). */
export function busyHours(
  checkIns: readonly { at: Date; valid: boolean }[],
  timezone: string,
): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  for (const c of checkIns) {
    if (!c.valid) continue;
    const parts = format.formatToParts(c.at);
    const weekday = WEEKDAY[parts.find((p) => p.type === 'weekday')!.value]!;
    const hour = Number(parts.find((p) => p.type === 'hour')!.value);
    grid[weekday]![hour]!++;
  }
  return grid;
}
