import { en, type Dictionary } from './i18n.en';
import { ar } from './i18n.ar';

export type { Dictionary };

export type Locale = 'en' | 'ar';

export const LOCALES: readonly Locale[] = ['en', 'ar'];

/** English is the default: it is what an unset cookie resolves to. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Where the choice lives.
 *
 * A cookie rather than `localStorage`, unlike the palette. The palette only
 * rewrites CSS variables, so the server and the client render byte-identical
 * markup and an inline script can swap it before first paint. Language rewrites
 * the text of every node -- markup React hydrates against -- so the server has
 * to already know which language it is rendering. A cookie is the only piece of
 * client state a server component can read.
 */
export const LOCALE_COOKIE = 'qc-lang';

/** A year. The choice is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Anything unrecognised -- a stale cookie, a hand-edited value -- falls back to English. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type Direction = 'ltr' | 'rtl';

export function directionFor(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
