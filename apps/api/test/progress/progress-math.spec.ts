import { describe, expect, it } from 'vitest';
import { todayIn } from '../../src/memberships/dates';
import {
  e1rm,
  isoWeekStart,
  lastWeeks,
  topSet,
  weeklyAttendance,
  weeklyVolume,
} from '../../src/progress/progress-math';

const WEEK = '2027-03-29'; // a Monday

const wr = (weightKg: number, reps: number, localDate = WEEK, done = true) => ({
  measure: 'weight_reps' as const,
  done,
  reps,
  weightKg,
  localDate,
});

describe('e1rm (Epley, rounded to 0.5 kg)', () => {
  it('rounds to the nearest half kilo', () => {
    expect(e1rm(100, 5)).toBe(116.5); // 116.67
    expect(e1rm(100, 1)).toBe(103.5); // 103.33
    expect(e1rm(60, 10)).toBe(80); // exactly 80
  });
  it('is null outside 1–12 reps', () => {
    expect(e1rm(100, 13)).toBeNull();
    expect(e1rm(100, 0)).toBeNull();
  });
  it('is 0 for a zero weight', () => {
    expect(e1rm(0, 10)).toBe(0);
  });
});

describe('topSet', () => {
  it('is the heaviest set, ties go to more reps', () => {
    expect(
      topSet([
        { weightKg: 60, reps: 8 },
        { weightKg: 70, reps: 5 },
        { weightKg: 70, reps: 6 },
      ]),
    ).toEqual({ weightKg: 70, reps: 6 });
  });
  it('is null without sets', () => {
    expect(topSet([])).toBeNull();
  });
});

describe('isoWeekStart and lastWeeks', () => {
  it('finds the Monday of the week', () => {
    expect(isoWeekStart('2027-03-29')).toBe('2027-03-29');
    expect(isoWeekStart('2027-03-28')).toBe('2027-03-22'); // a Sunday belongs to the week before
    expect(isoWeekStart('2027-03-31')).toBe('2027-03-29');
    expect(isoWeekStart('2027-01-01')).toBe('2026-12-28'); // across the year
  });
  it('lists n week starts, oldest first, the current week included', () => {
    expect(lastWeeks('2027-03-31', 3)).toEqual(['2027-03-15', '2027-03-22', '2027-03-29']);
    expect(lastWeeks('2027-03-29', 1)).toEqual(['2027-03-29']);
  });
});

describe('weeklyVolume', () => {
  const weeks = lastWeeks('2027-03-31', 3);
  it('sums weight × reps of done weight_reps sets per week: 3×10 @ 50 + 2×5 @ 80 = 2300', () => {
    const sets = [wr(50, 10), wr(50, 10), wr(50, 10), wr(80, 5), wr(80, 5)];
    expect(weeklyVolume(sets, weeks)).toEqual([
      { weekStart: '2027-03-15', volumeKg: 0 },
      { weekStart: '2027-03-22', volumeKg: 0 },
      { weekStart: '2027-03-29', volumeKg: 2300 },
    ]);
  });
  it('ignores reps and duration sets, undone sets, and weeks outside the range', () => {
    const sets = [
      wr(50, 10),
      { measure: 'reps' as const, done: true, reps: 20, weightKg: null, localDate: WEEK },
      { measure: 'duration' as const, done: true, reps: null, weightKg: null, localDate: WEEK },
      wr(100, 10, WEEK, false),
      wr(999, 10, '2027-01-04'),
    ];
    expect(weeklyVolume(sets, weeks).find((w) => w.weekStart === WEEK)!.volumeKg).toBe(500);
    expect(weeklyVolume(sets, weeks).reduce((n, w) => n + w.volumeKg, 0)).toBe(500);
  });
  it('puts a set logged at 00:30 Athens on Monday in that Monday’s week, not the week before', () => {
    const loggedAt = new Date('2027-03-28T21:30:00Z'); // 00:30 EEST on Monday 2027-03-29
    const localDate = todayIn('Europe/Athens', loggedAt);
    expect(localDate).toBe('2027-03-29');
    const out = weeklyVolume([wr(50, 10, localDate)], lastWeeks('2027-03-30', 2));
    expect(out).toEqual([
      { weekStart: '2027-03-22', volumeKg: 0 },
      { weekStart: '2027-03-29', volumeKg: 500 },
    ]);
  });
  it('keeps old weight_reps sets whatever the exercise is today (the measure is a snapshot)', () => {
    // The set carries the measure it was logged with; nothing about the exercise is consulted.
    expect(weeklyVolume([wr(40, 10)], [WEEK])).toEqual([{ weekStart: WEEK, volumeKg: 400 }]);
  });
});

describe('weeklyAttendance', () => {
  it('counts distinct gym days per week', () => {
    const days = ['2027-03-29', '2027-03-29', '2027-03-31', '2027-03-22'];
    expect(weeklyAttendance(days, ['2027-03-22', '2027-03-29'])).toEqual([
      { weekStart: '2027-03-22', days: 1 },
      { weekStart: '2027-03-29', days: 2 },
    ]);
  });
  it('gives 0 for a week without visits and ignores dates outside the weeks', () => {
    expect(weeklyAttendance(['2026-01-05'], ['2027-03-22'])).toEqual([
      { weekStart: '2027-03-22', days: 0 },
    ]);
  });
});
