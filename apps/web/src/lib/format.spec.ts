import { describe, expect, it } from 'vitest';
import { centsToInput, formatDate, formatMoney, parseEuros } from './format';

describe('formatMoney', () => {
  it('formats cents as euros in Greek and English', () => {
    expect(formatMoney(4000, 'el')).toBe('40,00 €');
    expect(formatMoney(4000, 'en')).toBe('€40.00');
    expect(formatMoney(3950, 'el')).toBe('39,50 €');
    expect(formatMoney(0, 'el')).toBe('0,00 €');
  });

  it('groups thousands', () => {
    expect(formatMoney(123456, 'el')).toBe('1.234,56 €');
    expect(formatMoney(123456, 'en')).toBe('€1,234.56');
  });
});

describe('formatDate', () => {
  it('formats a calendar date in Greek and English, never shifted a day', () => {
    expect(formatDate('2027-02-28', 'el')).toBe('28/2/2027');
    expect(formatDate('2027-02-28', 'en')).toBe('28/02/2027');
    expect(formatDate('2027-01-01', 'el')).toBe('1/1/2027');
  });
});

describe('parseEuros / centsToInput', () => {
  it('reads a typed price with a comma or a dot', () => {
    expect(parseEuros('39,50')).toBe(3950);
    expect(parseEuros('39.5')).toBe(3950);
    expect(parseEuros(' 40 ')).toBe(4000);
    expect(parseEuros('0,1')).toBe(10);
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '1,234', '39,505', '-5', '100000', '1e3']) {
      expect(parseEuros(bad), bad).toBeNull();
    }
  });

  it('shows cents back as a field value', () => {
    expect(centsToInput(3950, 'el')).toBe('39,50');
    expect(centsToInput(3950, 'en')).toBe('39.50');
  });
});
