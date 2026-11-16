import { describe, expect, it } from 'vitest';
import { membershipStatus, remaining } from '../../src/memberships/status';

const time = {
  kind: 'time' as const,
  startsOn: '2027-03-01',
  endsOn: '2027-03-28',
  visitsTotal: null,
  visitsUsed: 0,
  voidedAt: null,
};
const visits = {
  kind: 'visits' as const,
  startsOn: '2027-05-01',
  endsOn: null,
  visitsTotal: 10,
  visitsUsed: 0,
  voidedAt: null,
};

describe('membershipStatus', () => {
  it('is expired the day after the end date, active on it (the midnight-in-Athens case)', () => {
    expect(membershipStatus(time, [], '2027-03-29')).toBe('expired');
    expect(membershipStatus(time, [], '2027-03-28')).toBe('active');
  });

  it('is active on its first day and upcoming the day before', () => {
    expect(membershipStatus(time, [], '2027-03-01')).toBe('active');
    expect(membershipStatus(time, [], '2027-02-28')).toBe('upcoming');
  });

  it('is frozen on any day inside a freeze, including its first and last day', () => {
    const freezes = [{ startsOn: '2027-03-10', endsOn: '2027-03-12' }];
    const m = { ...time, endsOn: '2027-03-31' }; // effective end with the 3 frozen days
    expect(membershipStatus(m, freezes, '2027-03-09')).toBe('active');
    expect(membershipStatus(m, freezes, '2027-03-10')).toBe('frozen');
    expect(membershipStatus(m, freezes, '2027-03-12')).toBe('frozen');
    expect(membershipStatus(m, freezes, '2027-03-13')).toBe('active');
  });

  it('is used up once every visit is used, even before the end date', () => {
    const m = { ...visits, endsOn: '2027-12-31', visitsUsed: 10 };
    expect(membershipStatus(m, [], '2027-06-01')).toBe('used_up');
    expect(membershipStatus({ ...m, visitsUsed: 9 }, [], '2027-06-01')).toBe('active');
  });

  it('never expires by date without an end date', () => {
    expect(membershipStatus(visits, [], '2099-01-01')).toBe('active');
  });

  it('is voided whatever else is true', () => {
    const voidedAt = new Date('2027-03-02T10:00:00Z');
    expect(membershipStatus({ ...time, voidedAt }, [], '2027-03-05')).toBe('voided');
    expect(membershipStatus({ ...time, voidedAt }, [], '2027-02-01')).toBe('voided');
    expect(membershipStatus({ ...time, voidedAt }, [], '2027-04-01')).toBe('voided');
  });

  it('is expired, not used up, for a pack past its end with visits left', () => {
    const m = { ...visits, endsOn: '2027-05-31', visitsUsed: 3 };
    expect(membershipStatus(m, [], '2027-06-01')).toBe('expired');
  });
});

describe('membershipStatus precedence', () => {
  const freezes = [{ startsOn: '2027-06-01', endsOn: '2027-06-05' }];
  const usedUp = { ...visits, endsOn: '2027-05-31', visitsUsed: 10 };

  it('is used up, not expired, when both are true', () => {
    expect(membershipStatus(usedUp, [], '2027-07-01')).toBe('used_up');
  });

  it('is used up when more visits were used than bought', () => {
    expect(membershipStatus({ ...usedUp, visitsUsed: 11 }, [], '2027-05-10')).toBe('used_up');
  });

  it('is frozen before used up and before expired', () => {
    const m = { ...usedUp, endsOn: '2027-06-10' };
    expect(membershipStatus(m, freezes, '2027-06-03')).toBe('frozen');
    expect(membershipStatus({ ...time, endsOn: '2027-03-05' }, [
      { startsOn: '2027-03-10', endsOn: '2027-03-12' },
    ], '2027-03-11')).toBe('frozen');
  });

  it('is upcoming before the start even when used up', () => {
    expect(membershipStatus(usedUp, [], '2027-04-30')).toBe('upcoming');
  });

  it('is voided even inside a freeze or when used up', () => {
    const voidedAt = new Date('2027-05-02T10:00:00Z');
    expect(membershipStatus({ ...usedUp, voidedAt }, freezes, '2027-06-03')).toBe('voided');
    expect(membershipStatus({ ...usedUp, voidedAt }, [], '2027-05-10')).toBe('voided');
  });
});

describe('remaining', () => {
  it('never goes below 0 visits', () => {
    expect(remaining({ ...visits, visitsUsed: 12 }, [], '2027-05-10').visits).toBe(0);
  });

  it('counts the days left including today', () => {
    const m = { ...time, endsOn: '2027-05-31' };
    expect(remaining(m, [], '2027-05-29')).toEqual({ days: 3, visits: null });
    expect(remaining(m, [], '2027-05-31')).toEqual({ days: 1, visits: null });
  });

  it('has 0 days after the end and the full length before the start', () => {
    const m = { ...time, startsOn: '2027-05-01', endsOn: '2027-05-31' };
    expect(remaining(m, [], '2027-06-01')).toEqual({ days: 0, visits: null });
    expect(remaining(m, [], '2027-04-20')).toEqual({ days: 31, visits: null });
  });

  it('counts visits left, and days left only when the pack has an end date', () => {
    expect(remaining({ ...visits, visitsUsed: 4 }, [], '2027-05-10')).toEqual({
      days: null,
      visits: 6,
    });
    expect(remaining({ ...visits, endsOn: '2027-05-31', visitsUsed: 4 }, [], '2027-05-29')).toEqual(
      { days: 3, visits: 6 },
    );
  });
});
