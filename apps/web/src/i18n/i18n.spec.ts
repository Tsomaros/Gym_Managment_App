import { describe, expect, it } from 'vitest';
import en from './en.json';
import el from './el.json';
import i18n from './index';

describe('i18n', () => {
  it('starts in Greek', () => {
    expect(i18n.language).toBe('el');
    expect(i18n.t('auth.signIn')).toBe(el.auth.signIn);
  });

  it('falls back to English for a key missing from el.json, not the raw key', () => {
    expect('test' in el).toBe(false);
    expect(i18n.t('test.onlyInEnglish')).toBe(en.test.onlyInEnglish);
  });

  it('has every English key in Greek too, except the test-only one', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? keys(v as object, `${p}${k}.`) : [`${p}${k}`],
      );
    const missing = keys(en).filter((k) => !keys(el).includes(k) && !k.startsWith('test.'));
    expect(missing).toEqual([]);
  });
});
