import type { ClassSeries } from '@gym/shared';
import { describe, expect, it } from 'vitest';
import { localToUtc, materialiseSeries } from '../../src/classes/materialise';

const series = (over: Partial<ClassSeries> = {}): ClassSeries => ({
  id: 's1',
  classTypeId: 't1',
  weekday: 3,
  startsAt: '18:00',
  durationMinutes: 45,
  capacity: 12,
  trainerId: null,
  room: null,
  validFrom: '2027-05-05',
  validUntil: null,
  ...over,
});

describe('materialiseSeries', () => {
  it('creates every Wednesday occurrence in the range', () => {
    const out = materialiseSeries([series()], [], '2027-05-01', '2027-05-28');
    expect(out.map((o) => o.date)).toEqual(['2027-05-05', '2027-05-12', '2027-05-19', '2027-05-26']);
    expect(out[0]).toMatchObject({
      seriesId: 's1',
      startsAt: '18:00',
      endsAt: '18:45',
      capacity: 12,
      classTypeId: 't1',
    });
  });

  it('skips occurrences that already exist, even cancelled ones', () => {
    const out = materialiseSeries(
      [series()],
      [{ seriesId: 's1', date: '2027-05-12' }],
      '2027-05-01',
      '2027-05-28',
    );
    expect(out.map((o) => o.date)).toEqual(['2027-05-05', '2027-05-19', '2027-05-26']);
  });

  it('respects validFrom and validUntil (inclusive)', () => {
    const out = materialiseSeries(
      [series({ validFrom: '2027-05-12', validUntil: '2027-05-19' })],
      [],
      '2027-05-01',
      '2027-05-28',
    );
    expect(out.map((o) => o.date)).toEqual(['2027-05-12', '2027-05-19']);
  });

  it('does not create occurrences before validFrom when the range starts earlier', () => {
    // 2027-04-21 and 2027-04-28 are Wednesdays too, but the series starts on 2027-05-05.
    const out = materialiseSeries([series()], [], '2027-04-20', '2027-05-06');
    expect(out.map((o) => o.date)).toEqual(['2027-05-05']);
  });

  it('includes an occurrence that falls exactly on the first or the last day of the range', () => {
    expect(materialiseSeries([series()], [], '2027-05-05', '2027-05-05').map((o) => o.date)).toEqual([
      '2027-05-05',
    ]);
    expect(materialiseSeries([series()], [], '2027-05-26', '2027-05-26').map((o) => o.date)).toEqual([
      '2027-05-26',
    ]);
  });

  it('another series’ session on the same date does not hide this series’ occurrence', () => {
    const out = materialiseSeries(
      [series()],
      [{ seriesId: 'other', date: '2027-05-12' }],
      '2027-05-12',
      '2027-05-12',
    );
    expect(out.map((o) => o.date)).toEqual(['2027-05-12']);
  });

  it('two series on one day come out earliest start first, each with its own data', () => {
    const out = materialiseSeries(
      [series(), series({ id: 's2', startsAt: '07:30', durationMinutes: 60, capacity: 5 })],
      [],
      '2027-05-12',
      '2027-05-12',
    );
    expect(out.map((o) => [o.seriesId, o.startsAt, o.endsAt, o.capacity])).toEqual([
      ['s2', '07:30', '08:30', 5],
      ['s1', '18:00', '18:45', 12],
    ]);
  });
});

describe('localToUtc (Europe/Athens)', () => {
  it('uses UTC+3 after the spring switch on 2027-03-28', () => {
    expect(localToUtc('2027-03-28', '09:00', 'Europe/Athens').toISOString()).toBe(
      '2027-03-28T06:00:00.000Z',
    );
  });
  it('uses UTC+2 the day before the switch', () => {
    expect(localToUtc('2027-03-27', '09:00', 'Europe/Athens').toISOString()).toBe(
      '2027-03-27T07:00:00.000Z',
    );
  });
  it('a time in the spring gap (03:30 on 2027-03-28) moves forward to 04:30 local', () => {
    expect(localToUtc('2027-03-28', '03:30', 'Europe/Athens').toISOString()).toBe(
      '2027-03-28T01:30:00.000Z',
    );
  });
  it('a time in the autumn overlap (03:30 on 2027-10-31) takes the first occurrence', () => {
    expect(localToUtc('2027-10-31', '03:30', 'Europe/Athens').toISOString()).toBe(
      '2027-10-31T00:30:00.000Z',
    );
  });
  it('Athens times just before and after the spring gap and on the autumn switch day', () => {
    // Switch 2027-03-28: 03:00 EET (01:00Z) becomes 04:00 EEST. 02:59 is still +2, 04:00 is +3.
    expect(localToUtc('2027-03-28', '02:59', 'Europe/Athens').toISOString()).toBe('2027-03-28T00:59:00.000Z');
    expect(localToUtc('2027-03-28', '04:00', 'Europe/Athens').toISOString()).toBe('2027-03-28T01:00:00.000Z');
    // Switch 2027-10-31: 04:00 EEST (01:00Z) becomes 03:00 EET. 04:30 is after it, so +2.
    expect(localToUtc('2027-10-31', '04:30', 'Europe/Athens').toISOString()).toBe('2027-10-31T02:30:00.000Z');
    expect(localToUtc('2027-10-30', '09:00', 'Europe/Athens').toISOString()).toBe('2027-10-30T06:00:00.000Z');
  });
  it('midnight local is the evening before in UTC', () => {
    // 2027-05-12 00:00 at +3 = 2027-05-11 21:00Z
    expect(localToUtc('2027-05-12', '00:00', 'Europe/Athens').toISOString()).toBe('2027-05-11T21:00:00.000Z');
  });
  it('handles a zone behind UTC (America/New_York): gap and overlap', () => {
    // 2027-03-14 02:30 does not exist (02:00 EST = 07:00Z jumps to 03:00 EDT) -> 03:30 EDT = 07:30Z
    expect(localToUtc('2027-03-14', '02:30', 'America/New_York').toISOString()).toBe('2027-03-14T07:30:00.000Z');
    // 2027-11-07 01:30 happens twice; the first is EDT (-4) = 05:30Z
    expect(localToUtc('2027-11-07', '01:30', 'America/New_York').toISOString()).toBe('2027-11-07T05:30:00.000Z');
  });
  it('is a plain offset in a zone without DST', () => {
    expect(localToUtc('2027-06-01', '12:00', 'UTC').toISOString()).toBe('2027-06-01T12:00:00.000Z');
  });
});
