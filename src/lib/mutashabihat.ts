/**
 * Where else a passage's words occur in the Quran.
 *
 * The aligner's hardest calls are the ones the audio cannot settle. A phrase
 * that appears in seventy places sounds identical in all seventy, so deciding
 * which one was recited is a textual question wearing an acoustic disguise --
 * and `forcedAligner` reports exactly these as restarts and a lower agreement
 * score.
 *
 * This is the textual half of that answer: QUL's mutashabihat data, reshaped by
 * `scripts/qul-import.mjs` into "for this ayah, which of its words belong to a
 * phrase that occurs elsewhere, and where". 814 repeated phrases across 2,232
 * ayahs.
 *
 * Server side only -- it reads a file -- and absent is an ordinary answer: the
 * export is downloaded by hand from a signed-in QUL account, so a machine
 * without it simply gets nothing rather than an error.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** One occurrence: an ayah and the words within it, one-based and inclusive. */
export interface SimilarPassage {
  verseKey: string;
  from: number;
  to: number;
}

export interface SimilarPhrase {
  /** Where the phrase sits in the ayah that was asked about. */
  from: number;
  to: number;
  /** Everywhere else the same words occur, the asked-for ayah excluded. */
  elsewhere: SimilarPassage[];
}

export interface Imported {
  phrases: Record<string, SimilarPassage[]>;
  byVerse: Record<string, { from: number; to: number; phrase: string }[]>;
}

let cached: Imported | null | undefined;

function load(): Imported | null {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), 'data', 'qul', 'mutashabihat.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Imported;
    cached = parsed?.byVerse && parsed?.phrases ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export const mutashabihatAvailable = (): boolean => load() !== null;

/**
 * The repeated phrases in one ayah, most-repeated first.
 *
 * `words` narrows it to the phrases a caption actually shows: a caption over
 * the first half of an ayah should not be warned about a repeat in the half it
 * is not displaying. Given nothing, the whole ayah is considered.
 */
export function similarPhrasesIn(
  verseKey: string,
  words?: { from: number; to: number }
): SimilarPhrase[] {
  return selectPhrases(load(), verseKey, words);
}

/**
 * The selection itself, separated from where the data came from so it can be
 * tested without a 290 KB file on disk.
 */
export function selectPhrases(
  data: Imported | null,
  verseKey: string,
  words?: { from: number; to: number }
): SimilarPhrase[] {
  if (!data) return [];
  const here = data.byVerse[verseKey];
  if (!here?.length) return [];

  const out: SimilarPhrase[] = [];
  for (const entry of here) {
    // Inclusive ranges on both sides, so they overlap unless one ends before
    // the other begins.
    if (words && (entry.to < words.from || entry.from > words.to)) continue;

    const all = data.phrases[entry.phrase] || [];
    const elsewhere = all.filter(
      place => !(place.verseKey === verseKey && place.from === entry.from && place.to === entry.to)
    );
    if (!elsewhere.length) continue;
    out.push({ from: entry.from, to: entry.to, elsewhere });
  }

  return out.sort((a, b) => b.elsewhere.length - a.elsewhere.length);
}
