import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetweenInclusive,
  effectiveEnd,
  frozenDays,
  periodEnd,
  todayIn,
} from '../../src/memberships/dates';

describe('periodEnd (end date inclusive: the day before the same day N months later)', () => {
  it.each([
    ['2027-01-15', 1, '2027-02-14'],
    ['2027-01-31', 1, '2027-02-28'], // 31 Feb doesn't exist → last day of February
    ['2028-01-31', 1, '2028-02-29'], // leap year
    ['2027-03-31', 1, '2027-04-30'], // 31 Apr doesn't exist
    ['2027-11-01', 3, '2028-01-31'], // across the year end
    ['2027-01-01', 12, '2027-12-31'],
    ['2027-02-28', 1, '2027-03-27'],
    ['2027-12-31', 2, '2028-02-29'], // 31 Feb 2028 → 29 Feb
    ['2027-01-30', 1, '2027-02-28'], // 30 Feb doesn't exist
    ['2027-01-29', 1, '2027-02-28'], // 29 Feb 2027 doesn't exist
    ['2028-01-29', 1, '2028-02-28'], // 29 Feb 2028 exists → day before it, not the month end
    ['2027-03-30', 1, '2027-04-29'], // 30 Apr exists (last day) → day before, not 30 Apr
    ['2027-01-28', 1, '2027-02-27'], // 28 Feb exists (last day) → day before
    ['2027-01-15', 18, '2028-07-14'], // more than a year
  ])('periodEnd(%s, %i) = %s', (start, months, expected) => {
    expect(periodEnd(start, months)).toBe(expected);
  });
});

describe('todayIn (calendar day in the gym time zone)', () => {
  it('is already the 29th in Athens at 21:30 UTC on 28 March 2027 (summer time, UTC+3)', () => {
    expect(todayIn('Europe/Athens', new Date('2027-03-28T21:30:00Z'))).toBe('2027-03-29');
  });

  it('is the 31st in Athens at 21:30 UTC on 30 October 2027 (back to UTC+2 that night)', () => {
    expect(todayIn('Europe/Athens', new Date('2027-10-30T21:30:00Z'))).toBe('2027-10-31');
  });

  it('changes day at local midnight on the night summer time ends (still UTC+3 until 04:00)', () => {
    // 21:59 UTC on 30 Oct is 00:59 on 31 Oct at UTC+3 (DST ends at 04:00 local on 31 Oct).
    expect(todayIn('Europe/Athens', new Date('2027-10-30T21:59:00Z'))).toBe('2027-10-31');
    expect(todayIn('Europe/Athens', new Date('2027-10-30T20:59:00Z'))).toBe('2027-10-30');
  });

  it('flips to the next day exactly at local midnight on both sides of each DST change', () => {
    // Spring (summer time starts 28 Mar 03:00 local = 01:00 UTC): before it UTC+2, after UTC+3.
    expect(todayIn('Europe/Athens', new Date('2027-03-27T21:59:00Z'))).toBe('2027-03-27'); // 23:59
    expect(todayIn('Europe/Athens', new Date('2027-03-27T22:00:00Z'))).toBe('2027-03-28'); // 00:00
    expect(todayIn('Europe/Athens', new Date('2027-03-28T20:59:00Z'))).toBe('2027-03-28'); // 23:59 (+3)
    expect(todayIn('Europe/Athens', new Date('2027-03-28T21:00:00Z'))).toBe('2027-03-29'); // 00:00 (+3)
    // Autumn (ends 31 Oct 04:00 local = 01:00 UTC): from then UTC+2.
    expect(todayIn('Europe/Athens', new Date('2027-10-30T21:00:00Z'))).toBe('2027-10-31'); // 00:00 (+3)
    expect(todayIn('Europe/Athens', new Date('2027-10-31T21:59:00Z'))).toBe('2027-10-31'); // 23:59 (+2)
    expect(todayIn('Europe/Athens', new Date('2027-10-31T22:00:00Z'))).toBe('2027-11-01'); // 00:00 (+2)
  });

  it('differs from UTC and from another zone at the same instant', () => {
    const now = new Date('2027-06-01T02:00:00Z');
    expect(todayIn('UTC', now)).toBe('2027-06-01');
    expect(todayIn('America/New_York', now)).toBe('2027-05-31');
  });
});

describe('day arithmetic on ISO dates', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2027-03-28', 1)).toBe('2027-03-29'); // DST night has no effect on dates
  });

  it('counts days inclusively', () => {
    expect(daysBetweenInclusive('2027-05-10', '2027-05-16')).toBe(7);
    expect(daysBetweenInclusive('2027-05-10', '2027-05-10')).toBe(1);
    expect(daysBetweenInclusive('2027-02-27', '2027-03-01')).toBe(3);
    expect(daysBetweenInclusive('2027-03-27', '2027-03-29')).toBe(3); // across spring DST
    expect(daysBetweenInclusive('2027-10-30', '2027-11-01')).toBe(3); // across autumn DST
  });
});

describe('freezes', () => {
  it('sums frozen days inclusively', () => {
    expect(frozenDays([])).toBe(0);
    expect(
      frozenDays([
        { startsOn: '2027-05-10', endsOn: '2027-05-16' },
        { startsOn: '2027-05-20', endsOn: '2027-05-21' },
      ]),
    ).toBe(9);
  });

  it('moves the end forward by the frozen days', () => {
    expect(effectiveEnd('2027-05-31', [{ startsOn: '2027-05-10', endsOn: '2027-05-16' }])).toBe(
      '2027-06-07',
    );
    expect(effectiveEnd('2027-05-31', [])).toBe('2027-05-31');
  });

  it('has no end for a membership without one', () => {
    expect(effectiveEnd(null, [{ startsOn: '2027-05-10', endsOn: '2027-05-16' }])).toBeNull();
  });
});
