import type { ExpandedShift, ShiftRow, ShiftSeries, Weekday } from '@gym/shared';
import { shiftTimeSchema } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import { expandShifts, isoWeekday, isOnDuty } from '../../src/shifts/expand';

const series = (o: Partial<ShiftSeries> & Pick<ShiftSeries, 'id' | 'validFrom'>): ShiftSeries => ({
  staffId: 's1',
  weekday: 1,
  startsAt: '06:00',
  endsAt: '14:00',
  validUntil: null,
  ...o,
});
const row = (o: Partial<ShiftRow> & Pick<ShiftRow, 'id' | 'date'>): ShiftRow => ({
  staffId: 's1',
  startsAt: '10:00',
  endsAt: '18:00',
  seriesId: null,
  cancelled: false,
  note: null,
  ...o,
});
const brief = (xs: ExpandedShift[]) => xs.map((x) => `${x.date} ${x.startsAt}-${x.endsAt}`);

describe('isoWeekday', () => {
  it('numbers Monday 1 … Sunday 7', () => {
    expect(isoWeekday('2027-05-03')).toBe(1);
    expect(isoWeekday('2027-05-09')).toBe(7);
    expect(isoWeekday('2027-03-28')).toBe(7); // the DST switch day, a Sunday
  });
});

describe('expandShifts', () => {
  const range = ['2027-05-01', '2027-05-16'] as const;

  it('expands a weekly series on its weekday only', () => {
    const out = expandShifts([series({ id: 'a', validFrom: '2027-05-03' })], [], ...range);
    expect(brief(out)).toEqual(['2027-05-03 06:00-14:00', '2027-05-10 06:00-14:00']);
  });

  it('keeps old weeks on the old series when a new series starts next week', () => {
    const out = expandShifts(
      [
        series({ id: 'a', validFrom: '2027-05-03', validUntil: '2027-05-09' }),
        series({ id: 'b', validFrom: '2027-05-10', startsAt: '08:00', endsAt: '16:00' }),
      ],
      [],
      ...range,
    );
    expect(brief(out)).toEqual(['2027-05-03 06:00-14:00', '2027-05-10 08:00-16:00']);
    expect(out.map((x) => x.seriesId)).toEqual(['a', 'b']);
  });

  it('ends a series on validUntil inclusive', () => {
    const out = expandShifts(
      [series({ id: 'a', validFrom: '2027-05-03', validUntil: '2027-05-10' })],
      [],
      ...range,
    );
    expect(brief(out)).toEqual(['2027-05-03 06:00-14:00', '2027-05-10 06:00-14:00']);
  });

  it('replaces one occurrence with an override and drops a cancelled one', () => {
    const s = series({ id: 'a', validFrom: '2027-05-03' });
    const moved = expandShifts([s], [row({ id: 'r1', date: '2027-05-10', seriesId: 'a' })], ...range);
    expect(brief(moved)).toEqual(['2027-05-03 06:00-14:00', '2027-05-10 10:00-18:00']);
    expect(moved[1]!.shiftId).toBe('r1');
    expect(moved[0]!.shiftId).toBeNull();

    const cancelled = expandShifts(
      [s],
      [row({ id: 'r1', date: '2027-05-10', seriesId: 'a', cancelled: true })],
      ...range,
    );
    expect(brief(cancelled)).toEqual(['2027-05-03 06:00-14:00']);
  });

  it('ignores an override whose series is not active that day', () => {
    const out = expandShifts(
      [series({ id: 'a', validFrom: '2027-05-03', validUntil: '2027-05-09' })],
      [row({ id: 'r1', date: '2027-05-10', seriesId: 'a' })],
      ...range,
    );
    expect(brief(out)).toEqual(['2027-05-03 06:00-14:00']);
  });

  it('includes one-offs in range only, and sorts by date, start, staff', () => {
    const out = expandShifts(
      [series({ id: 'a', validFrom: '2027-05-03', staffId: 's2' })],
      [
        row({ id: 'o1', date: '2027-05-05', startsAt: '09:00', endsAt: '12:00' }),
        row({ id: 'o2', date: '2027-05-20', startsAt: '09:00', endsAt: '12:00' }),
        row({ id: 'o3', date: '2027-05-03', startsAt: '06:00', endsAt: '09:00', staffId: 's1' }),
        row({ id: 'o4', date: '2027-05-06', cancelled: true }),
      ],
      ...range,
    );
    expect(out.map((x) => `${x.date} ${x.startsAt} ${x.staffId}`)).toEqual([
      '2027-05-03 06:00 s1',
      '2027-05-03 06:00 s2',
      '2027-05-05 09:00 s1',
      '2027-05-10 06:00 s2',
    ]);
  });

  it('keeps a Sunday 06:00–14:00 shift at 06:00–14:00 on the DST switch day', () => {
    const out = expandShifts(
      [series({ id: 'a', validFrom: '2027-03-01', weekday: 7 as Weekday })],
      [],
      '2027-03-27',
      '2027-03-29',
    );
    expect(brief(out)).toEqual(['2027-03-28 06:00-14:00']);
  });
});

describe('isOnDuty', () => {
  const shifts = expandShifts(
    [series({ id: 'a', validFrom: '2027-05-03' })],
    [],
    '2027-05-03',
    '2027-05-03',
  );
  it('includes the start and excludes the end', () => {
    expect(isOnDuty(shifts, 's1', '2027-05-03', '05:59')).toBe(false);
    expect(isOnDuty(shifts, 's1', '2027-05-03', '06:00')).toBe(true);
    expect(isOnDuty(shifts, 's1', '2027-05-03', '13:59')).toBe(true);
    expect(isOnDuty(shifts, 's1', '2027-05-03', '14:00')).toBe(false);
  });
  it('is false for another person or another date', () => {
    expect(isOnDuty(shifts, 's2', '2027-05-03', '10:00')).toBe(false);
    expect(isOnDuty(shifts, 's1', '2027-05-04', '10:00')).toBe(false);
  });
});

describe('shiftTimeSchema', () => {
  it('accepts HH:MM in steps of 5 minutes and nothing else', () => {
    expect(shiftTimeSchema.safeParse('09:05').success).toBe(true);
    expect(shiftTimeSchema.safeParse('00:00').success).toBe(true);
    expect(shiftTimeSchema.safeParse('23:55').success).toBe(true);
    expect(shiftTimeSchema.safeParse('09:07').success).toBe(false);
    expect(shiftTimeSchema.safeParse('24:00').success).toBe(false);
    expect(shiftTimeSchema.safeParse('9:05').success).toBe(false);
  });
});
