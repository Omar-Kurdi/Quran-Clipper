/**
 * Dates and times as the library shows them: when a recording's project was
 * made and last edited, and when each clip was made and last exported.
 */

/** The formatting locale for the studio's language: day-month order and a 24-hour clock in English. */
const formatLocale = (locale: string) => (locale === 'ar' ? 'ar' : 'en-GB');

/** `18 Nov 2026, 06:33` -- or, `short`, `18 Nov, 06:33`; '' for anything that is not a time. */
export function formatStamp(iso: string | null | undefined, locale: string, short = false): string {
  const time = iso ? new Date(iso) : null;
  if (!time || Number.isNaN(time.getTime())) return '';
  return new Intl.DateTimeFormat(formatLocale(locale), {
    day: 'numeric', month: 'short', ...(short ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(time);
}
