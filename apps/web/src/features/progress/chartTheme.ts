/**
 * Colours and formats shared by the progress charts. The palette is the validated reference
 * palette of the dataviz skill (light surface; the app has no dark theme yet): slot 1 blue and
 * slot 2 orange, assigned in fixed order. Text never wears a series colour.
 */
export const CHART = {
  surface: '#fcfcfb',
  series1: '#2a78d6',
  series2: '#eb6834',
  grid: '#e4e3df',
  axis: '#52514e',
  text: '#0b0b0b',
} as const;

/** The eight categorical slots of the validated palette, in their fixed order (never cycled). */
export const SERIES = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
] as const;

/** The grey of the folded "Other" series. */
export const OTHER_COLOR = '#8b8a84';

/** A darker green than SERIES[2] for thin or faded marks (3:1 on the chart surface). */
export const GREEN_STRONG = '#0f7a54';

export const MARGIN = { top: 8, right: 12, bottom: 4, left: 0 } as const;

/** 2027-05-10 → "10 May" / "10 Μαΐ", the day in the viewer's language, never shifted by a zone. */
export function shortDate(iso: string, lang: 'el' | 'en'): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A number in the viewer's notation with at most `digits` decimals (52,5 in Greek). */
export function num(n: number, lang: 'el' | 'en', digits = 1): string {
  return new Intl.NumberFormat(lang === 'el' ? 'el-GR' : 'en-GB', {
    maximumFractionDigits: digits,
  }).format(n);
}

/** The weeks of a range as the months the member picked: 13 → 3, 26 → 6, 52 → 12. */
export const RANGES = [
  { months: 3, weeks: 13 },
  { months: 6, weeks: 26 },
  { months: 12, weeks: 52 },
] as const;
export const DEFAULT_WEEKS = 26;
