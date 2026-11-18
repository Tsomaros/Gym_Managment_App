import { describe, expect, it } from 'vitest';
import { exerciseName, viewerLanguage } from './exerciseName';

describe('viewerLanguage', () => {
  it('uses only the language part of the i18next code', () => {
    expect(viewerLanguage('en-GB')).toBe('en');
    expect(viewerLanguage('en')).toBe('en');
    expect(viewerLanguage('el-GR')).toBe('el');
    expect(viewerLanguage('el')).toBe('el');
  });

  it('falls back to Greek, the default, for any other language', () => {
    expect(viewerLanguage('fr')).toBe('el');
  });
});

describe('exerciseName', () => {
  const bench = { nameEl: 'Πιέσεις στήθους', nameEn: 'Bench press' };
  const own = { nameEl: 'Ώμοι με αλτήρες', nameEn: null };

  it('shows the Greek name in Greek, even when there is an English one', () => {
    expect(exerciseName(bench, 'el')).toBe('Πιέσεις στήθους');
  });

  it('shows the English name in English', () => {
    expect(exerciseName(bench, 'en')).toBe('Bench press');
  });

  it('falls back to the Greek name in English when there is no English one', () => {
    expect(exerciseName(own, 'en')).toBe('Ώμοι με αλτήρες');
  });

  it('treats an empty English name as missing', () => {
    expect(exerciseName({ nameEl: 'Σανίδα', nameEn: '' }, 'en')).toBe('Σανίδα');
  });
});
