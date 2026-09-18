/**
 * The content sync's decision, with no network and no server imports.
 *
 * Split from `contentSync.ts` so the studio can apply it to the auto-saved
 * draft in the browser -- the server fetches the current content and the
 * list of editions (`GET /api/content/current`), and this decides what
 * changes. See `contentSync.ts` for what the sync is and why.
 */

import type { VerseData, VerseWord } from './quranData';
import type { CorpusVerse } from './quranCorpus';
import type { TranslationTexts } from './translationTexts';

export interface ContentSyncInput {
  verses: VerseData[];
  /** The project's chosen editions, in card order. Empty means "the default". */
  translationIds: string[];
  /** The corpus's current text, by verse key. */
  corpus: Map<string, CorpusVerse>;
  /** Current text of the chosen editions, by verse key then id. */
  texts: TranslationTexts;
  /** Every edition still served. */
  available: Set<string>;
  /** What an emptied choice falls back to. */
  defaultId: string;
}

export interface ContentSyncResult {
  verses: VerseData[];
  translationIds: string[];
  /** Editions taken out because nobody serves them any more. */
  removedIds: string[];
  /**
   * False when some ayah could not be checked -- the upstream did not answer
   * for it. The caller must not record the project as synced: it is retried
   * next time rather than counted as current.
   */
  complete: boolean;
}

/** The word list, brought up to date without losing what the user did with it. */
function syncWords(stored: VerseWord[] | undefined, current: VerseWord[]): VerseWord[] {
  const fresh = current.map(word => ({
    arabic: word.arabic,
    translation: word.translation,
    ...(word.glyph && word.glyphPage ? { glyph: word.glyph, glyphPage: word.glyphPage } : {})
  }));
  // Same count: the same words, so each keeps its time and whether it is shown.
  // A different count means the upstream re-split the ayah; pairing by index
  // would put every time and every hidden word on the wrong word, so the list
  // is taken fresh and shown whole.
  if (stored && stored.length === current.length) {
    return fresh.map((word, index) => ({
      ...word,
      excluded: Boolean(stored[index].excluded),
      ...(typeof stored[index].timestamp === 'number' ? { timestamp: stored[index].timestamp } : {})
    }));
  }
  return fresh.map(word => ({ ...word, excluded: false }));
}

/** Drops `removed` from a keyed map, returning undefined when nothing is left. */
function without(map: Record<string, string> | undefined, removed: Set<string>): Record<string, string> | undefined {
  if (!map) return map;
  const kept = Object.fromEntries(Object.entries(map).filter(([id]) => !removed.has(id)));
  return Object.keys(kept).length ? kept : undefined;
}

export function applyContentSync(input: ContentSyncInput): ContentSyncResult {
  const removed = input.translationIds.filter(id => !input.available.has(id));
  const removedSet = new Set(removed);
  let translationIds = input.translationIds.filter(id => input.available.has(id));
  // A project that had chosen editions and lost all of them gets the default
  // rather than an empty choice, which would silently mean the same thing but
  // read as "no translation" to anyone looking at the row.
  if (input.translationIds.length && !translationIds.length) translationIds = [input.defaultId];

  let complete = true;
  const verses = input.verses.map(verse => {
    const current = input.corpus.get(verse.verseKey);
    if (!current) {
      complete = false;
      return verse;
    }
    const words = syncWords(verse.words, current.words);
    const onScreen = words.filter(word => !word.excluded).map(word => word.arabic).join(' ').trim();

    // Every chosen edition's text is replaced with what is served now. One the
    // upstream had nothing for this ayah is dropped rather than kept stale.
    const fetched = input.texts[verse.verseKey] || {};
    const translations: Record<string, string> = {};
    for (const id of Object.keys(verse.translations || {})) {
      if (!removedSet.has(id) && fetched[id]) translations[id] = fetched[id];
    }

    return {
      ...verse,
      textUthmani: current.textUthmani,
      displayTextUthmani: onScreen || current.textUthmani,
      translation: current.translation,
      words,
      translations: Object.keys(translations).length ? translations : undefined,
      displayTranslations: without(verse.displayTranslations, removedSet)
    };
  });

  return { verses, translationIds, removedIds: removed, complete };
}

