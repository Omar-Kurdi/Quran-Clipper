/**
 * Shortcuts on the Source tab, remembered per browser like the studio's other
 * ways of working (`uiPreference`): reciters starred as favourites, the ones
 * used lately, and passages bookmarked to come back to.
 */

import { createListPreference } from './uiPreference';

/** At most this many reciters are listed as used lately. */
export const RECENT_RECITERS = 3;
/** More than anyone keeps at hand, and a bound on what storage holds. */
export const MAX_FAVOURITES = 30;
export const MAX_BOOKMARKS = 50;

const reciterId = (entry: unknown): string | null => (typeof entry === 'string' && entry ? entry : null);

/** A passage bookmarked: a surah and a range of its ayahs. */
export interface PassageBookmark {
  surah: number;
  start: number;
  end: number;
}

const ayah = (value: unknown, least: number): number | null =>
  Number.isInteger(value) && (value as number) >= least ? (value as number) : null;

export function bookmarkOf(entry: unknown): PassageBookmark | null {
  const raw = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
  const surah = ayah(raw.surah, 1);
  const start = ayah(raw.start, 1);
  const end = ayah(raw.end, 1);
  if (surah === null || surah > 114 || start === null || end === null || end < start) return null;
  return { surah, start, end };
}

export const favouriteReciters = createListPreference('qc-favourite-reciters', reciterId, MAX_FAVOURITES);
export const recentReciters = createListPreference('qc-recent-reciters', reciterId, RECENT_RECITERS);
export const passageBookmarks = createListPreference('qc-passage-bookmarks', bookmarkOf, MAX_BOOKMARKS);

/** `id` starred if it was not, unstarred if it was. */
export const toggled = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];

/** `id` as the one used last, before the others, at most `RECENT_RECITERS` kept. */
export const usedLast = (ids: readonly string[], id: string): string[] =>
  [id, ...ids.filter(other => other !== id)].slice(0, RECENT_RECITERS);

/**
 * The reciters as the picker lists them: the favourites first, in the order
 * they were starred, then the ones used lately that are not favourites, then
 * all of them. A reciter no longer offered is left out of the first two.
 */
export function reciterGroups<R extends { id: string }>(
  reciters: readonly R[], favourites: readonly string[], recent: readonly string[]
): { favourites: R[]; recent: R[]; all: R[] } {
  const byId = new Map(reciters.map(reciter => [reciter.id, reciter]));
  const pick = (ids: readonly string[]) => ids.map(id => byId.get(id)).filter((reciter): reciter is R => !!reciter);
  return {
    favourites: pick(favourites),
    recent: pick(recent.filter(id => !favourites.includes(id))),
    all: [...reciters],
  };
}

export const sameBookmark = (a: PassageBookmark, b: PassageBookmark) =>
  a.surah === b.surah && a.start === b.start && a.end === b.end;

/** The passage bookmarked if it was not, its bookmark removed if it was; the newest first. */
export const toggledBookmark = (bookmarks: readonly PassageBookmark[], passage: PassageBookmark): PassageBookmark[] =>
  bookmarks.some(bookmark => sameBookmark(bookmark, passage))
    ? bookmarks.filter(bookmark => !sameBookmark(bookmark, passage))
    : [passage, ...bookmarks];
