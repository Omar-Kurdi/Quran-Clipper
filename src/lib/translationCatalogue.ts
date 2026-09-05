'use client';

import { TranslationOption } from './translations';

/**
 * The list of translations quran.com publishes, fetched once per page.
 *
 * About 130 entries across 40-odd languages. It is asked for the first time
 * someone opens the picker rather than at startup: a studio session that never
 * changes the translation should not pay for the list, and the one that does
 * is opening a dialog, which is a moment that can afford a request.
 */

let pending: Promise<TranslationOption[]> | null = null;
let loaded: TranslationOption[] | null = null;
let source: 'public' | 'foundation' | null = null;

/** What has already arrived, for a render that cannot wait. */
export const cachedCatalogue = (): TranslationOption[] | null => loaded;

/**
 * Which upstream answered.
 *
 * `public` is the open API, whose list of 126 does not include The Clear
 * Quran; `foundation` is the credentialed one, which does. The picker says so
 * rather than leaving an absent translation looking like a bug.
 */
export const catalogueSource = (): 'public' | 'foundation' | null => source;

export function loadTranslationCatalogue(): Promise<TranslationOption[]> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;

  pending = fetch('/api/quran/translations')
    .then(res => (res.ok ? res.json() : { translations: [] }))
    .then((data: { translations?: TranslationOption[]; source?: 'public' | 'foundation' }) => {
      const list = Array.isArray(data.translations) ? data.translations : [];
      if (list.length) source = data.source === 'foundation' ? 'foundation' : 'public';
      if (list.length) loaded = list;
      // An empty answer is not cached: the network may simply have been down,
      // and the next open should try again rather than show an empty picker
      // for the rest of the session.
      else pending = null;
      return list;
    })
    .catch(() => {
      pending = null;
      return [];
    });

  return pending;
}
