import type { Membership } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import { selectReminders } from '../../src/notifications/select-reminders';

const TODAY = '2027-05-26';
let n = 0;

function ms(over: Partial<Membership> & { endsOn?: string | null }): Membership {
  const end = 'endsOn' in over ? over.endsOn : '2027-05-31';
  return {
    id: `ms-${++n}`,
    memberId: 'm1',
    typeId: 't',
    name: 'Μηνιαία',
    kind: 'time',
    includesTrainer: false,
    includesClasses: false,
    maxFreezeDays: 0,
    priceCents: 4000,
    startsOn: '2027-05-01',
    endsOn: end ?? null,
    effectiveEndsOn: end ?? null,
    visitsTotal: null,
    visitsUsed: 0,
    voidedAt: null,
    status: 'active',
    remaining: { days: null, visits: null },
    createdAt: '2027-05-01T08:00:00.000Z',
    ...over,
  } as Membership;
}

const run = (memberships: Membership[], reminderDays = 5) =>
  selectReminders({ today: TODAY, reminderDays, memberships });

describe('selectReminders (today 2027-05-26, 5 days ahead)', () => {
  it('a membership ending in exactly 5 days gets "expiring"', () => {
    const m = ms({ effectiveEndsOn: '2027-05-31' });
    expect(run([m])).toEqual([
      expect.objectContaining({
        memberId: 'm1',
        membershipId: m.id,
        event: 'membership.expiring',
        endsOn: '2027-05-31',
        days: 5,
      }),
    ]);
  });

  it('a membership ending today gets "expires_today"', () => {
    const m = ms({ effectiveEndsOn: '2027-05-26' });
    expect(run([m]).map((r) => [r.event, r.endsOn])).toEqual([
      ['membership.expires_today', '2027-05-26'],
    ]);
  });

  it('nothing for 6 days ahead, 4 days ahead, yesterday, or a membership without an end', () => {
    expect(run([ms({ effectiveEndsOn: '2027-06-01' })])).toEqual([]);
    expect(run([ms({ effectiveEndsOn: '2027-05-30' })])).toEqual([]);
    expect(run([ms({ effectiveEndsOn: '2027-05-25', status: 'expired' })])).toEqual([]);
    expect(run([ms({ effectiveEndsOn: null, kind: 'visits', visitsTotal: 10 })])).toEqual([]);
  });

  it('nothing for an active membership whose end is already past, even across a month boundary', () => {
    // Status says active, so only the date can rule it out (-1 day, and -5 days, are not "5 away").
    expect(run([ms({ effectiveEndsOn: '2027-05-25' })])).toEqual([]);
    expect(run([ms({ effectiveEndsOn: '2027-05-21' })])).toEqual([]);
  });

  it('a lead time of 1 day matches tomorrow only, and the month boundary counts days correctly', () => {
    const tomorrow = ms({ effectiveEndsOn: '2027-05-27' });
    expect(run([tomorrow], 1).map((r) => [r.event, r.days])).toEqual([['membership.expiring', 1]]);
    expect(run([ms({ effectiveEndsOn: '2027-05-31' })], 1)).toEqual([]);
    // 2027-01-29 + 3 days = 2027-02-01 (January has 31 days).
    const jan = selectReminders({
      today: '2027-01-29',
      reminderDays: 3,
      memberships: [ms({ effectiveEndsOn: '2027-02-01' })],
    });
    expect(jan.map((r) => r.days)).toEqual([3]);
  });

  it('follows the gym setting: 7 days ahead matches only with reminderDays 7', () => {
    const m = ms({ effectiveEndsOn: '2027-06-02' });
    expect(run([m], 5)).toEqual([]);
    expect(run([m], 7).map((r) => r.event)).toEqual(['membership.expiring']);
  });

  it('skips a frozen, voided, upcoming or used-up membership', () => {
    for (const status of ['frozen', 'upcoming', 'used_up'] as const) {
      expect(run([ms({ effectiveEndsOn: '2027-05-31', status })])).toEqual([]);
    }
    expect(
      run([
        ms({ effectiveEndsOn: '2027-05-31', status: 'voided', voidedAt: '2027-05-02T00:00:00Z' }),
      ]),
    ).toEqual([]);
  });

  it('skips a member who already renewed: the next membership starts the day after, or on, the end', () => {
    const ending = ms({ effectiveEndsOn: '2027-05-31' });
    const next = ms({ startsOn: '2027-06-01', effectiveEndsOn: '2027-06-30', status: 'upcoming' });
    expect(run([ending, next]).map((r) => r.membershipId)).toEqual([]);
    const sameDay = ms({
      startsOn: '2027-05-31',
      effectiveEndsOn: '2027-06-30',
      status: 'upcoming',
    });
    expect(run([ending, sameDay])).toEqual([]);
  });

  it('a renewal that was voided does not count, nor does one that starts more than a day later', () => {
    const ending = ms({ effectiveEndsOn: '2027-05-31' });
    const voided = ms({
      startsOn: '2027-06-01',
      effectiveEndsOn: '2027-06-30',
      status: 'voided',
      voidedAt: '2027-05-20T00:00:00Z',
    });
    const late = ms({ startsOn: '2027-06-02', effectiveEndsOn: '2027-06-30', status: 'upcoming' });
    expect(run([ending, voided, late]).map((r) => r.membershipId)).toEqual([ending.id]);
  });

  it("someone else's renewal does not hide this member's reminder", () => {
    const ending = ms({ effectiveEndsOn: '2027-05-31' });
    const other = ms({
      memberId: 'm2',
      startsOn: '2027-06-01',
      effectiveEndsOn: '2027-06-30',
      status: 'upcoming',
    });
    expect(run([ending, other]).map((r) => r.memberId)).toEqual(['m1']);
  });

  it('a visit pack with an end date follows the same rules', () => {
    const pack = ms({
      kind: 'visits',
      visitsTotal: 10,
      visitsUsed: 3,
      effectiveEndsOn: '2027-05-31',
    });
    expect(run([pack]).map((r) => r.event)).toEqual(['membership.expiring']);
  });

  it('a member with two ending memberships gets a reminder for each', () => {
    const a = ms({ effectiveEndsOn: '2027-05-31' });
    const b = ms({ effectiveEndsOn: '2027-05-26' });
    expect(
      run([a, b])
        .map((r) => r.event)
        .sort(),
    ).toEqual(['membership.expires_today', 'membership.expiring']);
  });
});
