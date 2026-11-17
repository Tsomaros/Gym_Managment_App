import type { Membership } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import { decideCheckIn, relevantMembership } from '../../src/checkin/decide';

let n = 0;
/** A hand-built membership, already evaluated for "today". */
function ms(over: Partial<Membership>): Membership {
  n += 1;
  return {
    id: `m${n}`,
    memberId: 'member',
    typeId: 'type',
    name: 'Συνδρομή',
    kind: 'time',
    includesTrainer: false,
    includesClasses: false,
    maxFreezeDays: 0,
    priceCents: 4000,
    startsOn: '2027-05-01',
    endsOn: '2027-05-31',
    effectiveEndsOn: '2027-05-31',
    visitsTotal: null,
    visitsUsed: 0,
    voidedAt: null,
    status: 'active',
    remaining: { days: 10, visits: null },
    createdAt: `2027-05-01T09:00:0${n % 10}.000Z`,
    ...over,
  };
}
const pack = (over: Partial<Membership> = {}) =>
  ms({
    kind: 'visits',
    visitsTotal: 10,
    visitsUsed: 2,
    remaining: { days: null, visits: 8 },
    endsOn: null,
    effectiveEndsOn: null,
    ...over,
  });

describe('decideCheckIn', () => {
  it('lets an active time membership in without consuming a visit, even next to an active pack', () => {
    const time = ms({});
    expect(decideCheckIn([pack(), time])).toEqual({
      valid: true,
      useMembershipId: time.id,
      consumeVisit: false,
    });
  });

  it('uses the pack that ends first, packs without an end last', () => {
    const open = pack({ createdAt: '2027-04-01T00:00:00.000Z' });
    const ending = pack({ effectiveEndsOn: '2027-06-30', endsOn: '2027-06-30' });
    expect(decideCheckIn([open, ending])).toEqual({
      valid: true,
      useMembershipId: ending.id,
      consumeVisit: true,
    });
  });

  it('breaks a tie between equal ends by the older sale', () => {
    const older = pack({ createdAt: '2027-04-01T00:00:00.000Z' });
    const newer = pack({ createdAt: '2027-04-02T00:00:00.000Z' });
    expect(decideCheckIn([newer, older])).toMatchObject({ useMembershipId: older.id });
  });

  it('accepts an active day pass and consumes its visit', () => {
    const day = ms({
      kind: 'day_pass',
      visitsTotal: 1,
      remaining: { days: null, visits: 1 },
    });
    expect(decideCheckIn([day])).toEqual({
      valid: true,
      useMembershipId: day.id,
      consumeVisit: true,
    });
  });

  it.each([
    ['only a frozen time membership', [ms({ status: 'frozen' })], 'frozen'],
    [
      'frozen next to an expired one',
      [ms({ status: 'frozen' }), ms({ status: 'expired' })],
      'frozen',
    ],
    ['only an upcoming membership', [ms({ status: 'upcoming' })], 'upcoming_only'],
    [
      'upcoming next to an expired one',
      [ms({ status: 'upcoming' }), ms({ status: 'expired' })],
      'upcoming_only',
    ],
    [
      'only an active class pack',
      [ms({ kind: 'classes', visitsTotal: 8, remaining: { days: null, visits: 8 } })],
      'classes_only',
    ],
    [
      'a used-up pack',
      [pack({ status: 'used_up', remaining: { days: null, visits: 0 } })],
      'used_up',
    ],
    [
      'a used-up pack next to an expired one',
      [pack({ status: 'used_up' }), ms({ status: 'expired' })],
      'used_up',
    ],
    ['an expired membership', [ms({ status: 'expired' })], 'expired'],
    ['only a voided membership', [ms({ status: 'voided' })], 'no_membership'],
    ['no memberships', [], 'no_membership'],
  ] as const)('refuses %s with %s', (_name, list, reason) => {
    expect(decideCheckIn([...list])).toEqual({ valid: false, reason });
  });

  it('refuses a frozen member even when a class pack is active (frozen wins over classes_only)', () => {
    const classes = ms({ kind: 'classes', visitsTotal: 8, remaining: { days: null, visits: 8 } });
    expect(decideCheckIn([classes, ms({ status: 'frozen' })])).toEqual({
      valid: false,
      reason: 'frozen',
    });
  });
});

describe('relevantMembership', () => {
  it('names the frozen one for frozen, the earliest start for upcoming_only, the latest end for expired', () => {
    const frozen = ms({ status: 'frozen' });
    expect(relevantMembership([ms({ status: 'expired' }), frozen], 'frozen')).toBe(frozen);

    const soon = ms({ status: 'upcoming', startsOn: '2027-06-01' });
    const later = ms({ status: 'upcoming', startsOn: '2027-07-01' });
    expect(relevantMembership([later, soon], 'upcoming_only')).toBe(soon);

    const old = ms({ status: 'expired', effectiveEndsOn: '2027-03-31' });
    const recent = ms({ status: 'expired', effectiveEndsOn: '2027-04-30' });
    expect(relevantMembership([old, recent], 'expired')).toBe(recent);
  });

  it('is null for no_membership, and ignores voided memberships', () => {
    expect(relevantMembership([ms({ status: 'voided' })], 'no_membership')).toBeNull();
    expect(relevantMembership([ms({ status: 'voided' })], 'expired')).toBeNull();
  });
});
