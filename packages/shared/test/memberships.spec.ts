import { describe, expect, it } from 'vitest';
import { MembershipTypeInputSchema } from '../src/index.js';

const base = { name: 'Μηνιαία', priceCents: 4000 };
const parse = (v: Record<string, unknown>) =>
  MembershipTypeInputSchema.safeParse({ ...base, ...v });

describe('MembershipTypeInputSchema', () => {
  it('accepts a 1-month time type and fills the optional rules', () => {
    const r = parse({ kind: 'time', durationMonths: 1 });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      kind: 'time',
      durationMonths: 1,
      maxFreezeDays: 0,
      includesTrainer: false,
      includesClasses: false,
    });
  });

  it('time: needs 1 to 36 months', () => {
    expect(parse({ kind: 'time', durationMonths: 0 }).success).toBe(false);
    expect(parse({ kind: 'time', durationMonths: 37 }).success).toBe(false);
    expect(parse({ kind: 'time', durationMonths: 36 }).success).toBe(true);
    expect(parse({ kind: 'time' }).success).toBe(false);
  });

  it('visits: needs 1 to 500 visits, optional validity of 1 to 730 days, and no freezing', () => {
    expect(parse({ kind: 'visits', visitCount: 10 }).success).toBe(true);
    expect(parse({ kind: 'visits', visitCount: 10, validityDays: 90 }).success).toBe(true);
    expect(parse({ kind: 'visits', visitCount: 0 }).success).toBe(false);
    expect(parse({ kind: 'visits', visitCount: 501 }).success).toBe(false);
    expect(parse({ kind: 'visits', visitCount: 10, validityDays: 731 }).success).toBe(false);
    expect(parse({ kind: 'visits', visitCount: 10, maxFreezeDays: 5 }).success).toBe(false);
  });

  it('classes: must include group classes', () => {
    expect(parse({ kind: 'classes', visitCount: 12, includesClasses: true }).success).toBe(true);
    expect(parse({ kind: 'classes', visitCount: 12, includesClasses: false }).success).toBe(false);
  });

  it('day pass: takes no duration, visits or freezing', () => {
    expect(parse({ kind: 'day_pass' }).success).toBe(true);
    expect(parse({ kind: 'day_pass', maxFreezeDays: 1 }).success).toBe(false);
  });

  it('rejects a negative or fractional price and an empty name', () => {
    expect(parse({ kind: 'day_pass', priceCents: -1 }).success).toBe(false);
    expect(parse({ kind: 'day_pass', priceCents: 10.5 }).success).toBe(false);
    expect(parse({ kind: 'day_pass', name: '  ' }).success).toBe(false);
    expect(parse({ kind: 'day_pass', priceCents: 0 }).success).toBe(true);
  });

  it('accepts the upper and lower limits of the visit and freeze rules', () => {
    expect(parse({ kind: 'visits', visitCount: 1 }).success).toBe(true);
    expect(parse({ kind: 'visits', visitCount: 500, validityDays: 730 }).success).toBe(true);
    expect(parse({ kind: 'visits', visitCount: 10, validityDays: 0 }).success).toBe(false);
    expect(parse({ kind: 'time', durationMonths: 1, maxFreezeDays: 365 }).success).toBe(true);
    expect(parse({ kind: 'time', durationMonths: 1, maxFreezeDays: 366 }).success).toBe(false);
    expect(parse({ kind: 'time', durationMonths: 1, maxFreezeDays: -1 }).success).toBe(false);
  });

  it('rejects a price above the typo guard of 10,000,000 cents', () => {
    expect(parse({ kind: 'day_pass', priceCents: 10_000_000 }).success).toBe(true);
    expect(parse({ kind: 'day_pass', priceCents: 10_000_001 }).success).toBe(false);
  });

  it('rejects a name over 80 characters and trims the name', () => {
    expect(parse({ kind: 'day_pass', name: 'α'.repeat(81) }).success).toBe(false);
    expect(parse({ kind: 'day_pass', name: '  Ημερήσια  ' }).data).toMatchObject({
      name: 'Ημερήσια',
    });
  });

  it('rejects an unknown kind', () => {
    expect(parse({ kind: 'yearly' }).success).toBe(false);
  });
});
