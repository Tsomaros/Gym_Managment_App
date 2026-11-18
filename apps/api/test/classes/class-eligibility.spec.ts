import type { Membership } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import { classEligibility } from '../../src/classes/class-eligibility';

const ms = (over: Partial<Membership> & { id: string }): Membership => ({
  memberId: 'm',
  typeId: 't',
  name: 'x',
  kind: 'time',
  includesTrainer: false,
  includesClasses: false,
  maxFreezeDays: 0,
  priceCents: 0,
  startsOn: '2027-05-01',
  endsOn: '2027-06-01',
  effectiveEndsOn: '2027-06-01',
  visitsTotal: null,
  visitsUsed: 0,
  voidedAt: null,
  status: 'active',
  remaining: { days: 10, visits: null },
  createdAt: '2027-05-01T00:00:00Z',
  ...over,
});
const pack = (id: string, total: number, used = 0, over: Partial<Membership> = {}): Membership =>
  ms({
    id,
    kind: 'classes',
    includesClasses: true,
    endsOn: null,
    effectiveEndsOn: null,
    visitsTotal: total,
    visitsUsed: used,
    ...over,
  });

describe('classEligibility (memberships evaluated for the session date)', () => {
  it('a time membership with classes is ok and uses no entry', () => {
    expect(classEligibility([ms({ id: 'a', includesClasses: true })], {})).toEqual({
      ok: true,
      membershipId: 'a',
      usesEntry: false,
    });
  });

  it('a time membership without classes is not ok', () => {
    expect(classEligibility([ms({ id: 'a' })], {})).toEqual({ ok: false });
  });

  it('a class pack with 1 left and 1 reserved is not ok; with 2 left and 1 reserved it is', () => {
    expect(classEligibility([pack('p', 3, 2)], { p: 1 })).toEqual({ ok: false });
    expect(classEligibility([pack('p', 3, 1)], { p: 1 })).toEqual({
      ok: true,
      membershipId: 'p',
      usesEntry: true,
    });
  });

  it('with both kinds, the time membership is used', () => {
    const r = classEligibility([pack('p', 5), ms({ id: 'a', includesClasses: true })], {});
    expect(r).toEqual({ ok: true, membershipId: 'a', usesEntry: false });
  });

  it('a time membership that is not active that day does not count; the pack does', () => {
    const frozen = ms({ id: 'a', includesClasses: true, status: 'frozen' });
    expect(classEligibility([frozen, pack('p', 2)], {})).toMatchObject({ membershipId: 'p' });
    expect(classEligibility([frozen], {})).toEqual({ ok: false });
  });

  it('an inactive pack (expired, used up, voided, upcoming) does not count', () => {
    for (const status of ['expired', 'used_up', 'voided', 'upcoming'] as const) {
      expect(classEligibility([pack('p', 5, 0, { status })], {})).toEqual({ ok: false });
    }
  });

  it('a visits pack that includes classes counts as a time-like membership, no entry used', () => {
    const visits = ms({ id: 'v', kind: 'visits', includesClasses: true, visitsTotal: 10 });
    expect(classEligibility([visits], {})).toEqual({
      ok: true,
      membershipId: 'v',
      usesEntry: false,
    });
  });
});
