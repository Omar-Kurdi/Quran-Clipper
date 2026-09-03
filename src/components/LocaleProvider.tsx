'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  dictionaryFor,
  directionFor,
  type Dictionary,
  type Direction,
  type Locale
} from '@/lib/i18n';

interface LocaleContextValue {
  locale: Locale;
  dir: Direction;
  /** The active dictionary. Named `t` because every call site reads `t.something`. */
  t: Dictionary;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Carries the language through the studio.
 *
 * The initial value comes from the server, which read the cookie before
 * rendering -- so the first paint is already in the right language and the
 * markup React hydrates against matches what the browser has. That is the whole
 * reason this is a prop rather than something read from `document` on mount.
 *
 * Switching does two things, and needs both: state, so this session updates
 * without a reload, and the cookie, so the *next* server render starts in the
 * new language rather than flashing English first.
 */
export const LocaleProvider: React.FC<{ locale: Locale; children: React.ReactNode }> = ({
  locale: initialLocale,
  children
}) => {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // `lang`/`dir` are written by the server for the first render; this keeps them
  // true after a switch. Done in an effect rather than the click handler because
  // mutating documentElement during an event is what react-hooks rejects -- the
  // same reason PaletteSwitcher defers its own attribute write.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionFor(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      // Cookies can be refused. The choice still applies for this session, which
      // is better than refusing to switch at all.
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: directionFor(locale), t: dictionaryFor(locale), setLocale }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

/**
 * The language, the direction and the strings.
 *
 * Falls back to English rather than throwing when there is no provider above:
 * a component rendered in isolation -- a test, a future embed -- should still
 * paint readable labels instead of crashing.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    dir: directionFor(DEFAULT_LOCALE),
    t: dictionaryFor(DEFAULT_LOCALE),
    setLocale: () => {}
  };
}

/** Shorthand for the common case: only the strings are wanted. */
export function useT(): Dictionary {
  return useLocale().t;
}
