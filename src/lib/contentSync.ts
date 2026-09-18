/**
 * Keeping stored Quran content current.
 *
 * The Quran Foundation allows a saved project to keep verse and translation
 * text indefinitely on one condition: the stored copy is checked against the
 * upstream, and updates, deletions and invalidations applied, at least once
 * every seven days. This is that check.
 *
 * What is *content* and gets rewritten: the ayah's Arabic, its word list (the
 * words, their word-by-word glosses, their mushaf glyphs), the caption's own
 * translation, and every chosen translation's text. What is the user's and is
 * left alone: timings, which words are hidden, hand corrections to a
 * translation, and everything about how the video looks.
 *
 * Deletion is part of it. An edition nobody serves any more is taken out of
 * the project -- its id, its fetched text and any correction written against
 * it -- and if that leaves no translation chosen, the default takes its place.
 *
 * `applyContentSync` is the whole decision and touches no network, so it can
 * be tested. `syncProjectContent` fetches what it needs and calls it.
 */

import type { VerseData } from './quranData';
import { getChapter, type CorpusVerse } from './quranCorpus';
import { defaultTranslationId } from './quranApi';
import { fetchTranslationTexts, availableTranslationIds, type TranslationTexts } from './translationTexts';
import { applyContentSync, type ContentSyncResult } from './contentSyncCore';

export { CONTENT_SYNC_MAX_AGE_MS, needsContentSync } from './contentSyncAge';
export { applyContentSync } from './contentSyncCore';
export type { ContentSyncInput, ContentSyncResult } from './contentSyncCore';

/** One surah's worth of ayahs to check, as `{ surah, start, end }`. */
export interface AyahRange {
  surah: number;
  start: number;
  end: number;
}

/** The ranges that cover a timeline's verse keys, one per surah. */
export function rangesOf(verseKeys: string[]): AyahRange[] {
  const bySurah = new Map<number, number[]>();
  for (const key of verseKeys) {
    const [surah, ayah] = key.split(':').map(Number);
    if (!Number.isFinite(surah) || !Number.isFinite(ayah)) continue;
    bySurah.set(surah, [...(bySurah.get(surah) || []), ayah]);
  }
  return [...bySurah].map(([surah, ayahs]) => ({ surah, start: Math.min(...ayahs), end: Math.max(...ayahs) }));
}

export interface SyncSources {
  corpus: CorpusVerse[];
  texts: TranslationTexts;
  available: string[];
  defaultId: string;
}

/**
 * Everything a sync compares against: the corpus for `ranges`, the current
 * text of the `keyed` editions, and every edition still served.
 *
 * Null when the list of editions or a requested translation could not be
 * read. Unreachable is not the same as deleted, and with no way to tell them
 * apart the safe answer is "not checked" -- the stored copy is tried again
 * next time rather than stripped.
 */
export async function fetchSyncSources(ranges: AyahRange[], keyed: string[]): Promise<SyncSources | null> {
  const available = await availableTranslationIds();
  if (!available) return null;
  const wanted = keyed.filter(id => available.has(id)).slice(0, 5);

  // Surahs in parallel: a project is nearly always one, and after the first
  // check each chapter is served from the cache in `quranCorpus`.
  const results = await Promise.all(
    ranges.map(async ({ surah, start, end }) => ({
      // A chapter that would not load contributes nothing, and the sync then
      // reports the project incomplete.
      chapter: (await getChapter(surah).catch(() => [] as CorpusVerse[]))
        .filter(verse => verse.verseNumber >= start && verse.verseNumber <= end),
      texts: wanted.length ? await fetchTranslationTexts(surah, start, end, wanted) : ({} as TranslationTexts)
    }))
  );
  if (results.some(result => !result.texts)) return null;
  return {
    corpus: results.flatMap(result => result.chapter),
    texts: Object.assign({}, ...results.map(result => result.texts)),
    available: [...available],
    defaultId: defaultTranslationId()
  };
}

/** Brings one project's stored content up to date, or null if it could not be checked. */
export async function syncProjectContent(
  verses: VerseData[],
  translationIds: string[]
): Promise<ContentSyncResult | null> {
  // Editions held in `translations` rather than in the caption's own field.
  const keyed = [...new Set(verses.flatMap(verse => Object.keys(verse.translations || {})))];
  const sources = await fetchSyncSources(rangesOf(verses.map(verse => verse.verseKey)), keyed);
  if (!sources) return null;
  return applyContentSync({
    verses,
    translationIds,
    corpus: new Map(sources.corpus.map(verse => [verse.verseKey, verse])),
    texts: sources.texts,
    available: new Set(sources.available),
    defaultId: sources.defaultId
  });
}
