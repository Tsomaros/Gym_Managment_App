const LOCALE_TAG = { el: 'el-GR', en: 'en-GB' } as const;
type Lang = keyof typeof LOCALE_TAG;

const tag = (locale: string): string =>
  LOCALE_TAG[(locale as Lang) in LOCALE_TAG ? (locale as Lang) : 'el'];

/** Euro cents as money in the UI language: 4000 → "40,00 €" (el) or "€40.00" (en). */
export function formatMoney(cents: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'EUR' })
    .format(cents / 100)
    .replace(/[\u00a0\u202f]/g, ' '); // Intl puts a (narrow) no-break space before "€"
}

/** A calendar date (YYYY-MM-DD) in the UI language: "28/2/2027" (el). Never shifted by time zone. */
export function formatDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(tag(locale), { timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/**
 * A price typed in euros ("39,50", "39.5", "40") as cents, or null if it isn't a valid amount.
 * At most two decimals; no thousands separators.
 */
export function parseEuros(input: string): number | null {
  const s = input.trim().replace(',', '.');
  // Up to 99.999,99 €, below the API's typo guard of 100.000 €.
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Cents as the plain number a price field shows when editing: 3950 → "39,50" (el). */
export function centsToInput(cents: number, locale: string): string {
  const s = (cents / 100).toFixed(2);
  return locale === 'el' ? s.replace('.', ',') : s;
}
