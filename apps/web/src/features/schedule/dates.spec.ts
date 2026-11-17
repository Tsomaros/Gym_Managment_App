import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, mondayOf, todayIn, weekDates } from './dates';

describe('schedule dates', () => {
  it('finds the Monday of any day of the week, Sunday included', () => {
    expect(mondayOf('2027-05-03')).toBe('2027-05-03'); // Monday
    expect(mondayOf('2027-05-05')).toBe('2027-05-03');
    expect(mondayOf('2027-05-09')).toBe('2027-05-03'); // Sunday belongs to the week before
    expect(mondayOf('2027-05-10')).toBe('2027-05-10');
  });

  it('lists the seven days of a week and moves across months', () => {
    expect(weekDates('2027-05-31')).toEqual([
      '2027-05-31',
      '2027-06-01',
      '2027-06-02',
      '2027-06-03',
      '2027-06-04',
      '2027-06-05',
      '2027-06-06',
    ]);
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('numbers weekdays like the API: Monday 1, Sunday 7', () => {
    expect(isoWeekday('2027-05-03')).toBe(1);
    expect(isoWeekday('2027-05-09')).toBe(7);
  });

  it('gives the gym date, not the UTC date, near midnight', () => {
    // 2027-05-12 21:30 UTC is already the 13th in Athens (UTC+3)
    expect(todayIn('Europe/Athens', new Date('2027-05-12T21:30:00Z'))).toBe('2027-05-13');
    expect(todayIn('Europe/Athens', new Date('2027-05-12T20:59:00Z'))).toBe('2027-05-12');
  });
});
