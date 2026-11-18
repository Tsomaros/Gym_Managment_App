type Lang = 'el' | 'en';
const tag = (lang: Lang) => (lang === 'el' ? 'el-GR' : 'en-GB');

/** 2027-05 → "Μαΐ 27" / "May 27". */
export function monthLabel(month: string, lang: Lang): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(tag(lang), { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(/\./g, '');
}

/** 2027-05 → "Μαΐ" / "May": the axis label, short enough for 12 bars on a phone. */
export function monthAxisLabel(month: string, lang: Lang): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(tag(lang), { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))
    .replace(/\./g, '');
}

/** Weekday 0 = Monday … 6 = Sunday, in the viewer's language: "Δευτέρα" or "Δευ". */
export function weekdayName(index: number, lang: Lang, style: 'long' | 'short'): string {
  // 2027-03-29 is a Monday.
  const date = new Date(Date.UTC(2027, 2, 29 + index));
  return new Intl.DateTimeFormat(tag(lang), { weekday: style, timeZone: 'UTC' })
    .format(date)
    .replace(/\.$/, '');
}

/** 7 → "07:00". */
export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** The end of the slot that starts at hour `h`: 23 ends at "24:00", not "00:00". */
export const endHourLabel = (h: number): string => (h === 23 ? '24:00' : hourLabel(h + 1));
