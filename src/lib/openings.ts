/**
 * Captions for what a reciter says before the passage: the isti'adha and the
 * basmala, when the sidecar heard them (its `phoneme_openings.py`).
 *
 * Neither is an ayah of the passage, so neither has a verse key of the usual
 * `surah:ayah` form. Their key is their kind, with no colon: everything that
 * reads a key as a surah and an ayah -- the badge, the content sync, the ground
 * truth file -- finds no number in it and passes over it, and the card draws
 * no ayah numeral for verse 0.
 */

import type { VerseData, VerseWord } from './quranData';

export const OPENING_KINDS = ['istiadha', 'basmala'] as const;
export type OpeningKind = typeof OPENING_KINDS[number];

/** What the sidecar reports for one opening, its times against the whole recording. */
export interface HeardOpening {
  kind: OpeningKind;
  text: string;
  start: number;
  end: number;
  words: { text: string; start: number }[];
}

const TRANSLATION: Record<OpeningKind, string> = {
  istiadha: 'I seek refuge in Allah from Satan, the accursed.',
  basmala: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'
};

export const isOpening = (verse: { verseKey: string }): boolean =>
  (OPENING_KINDS as readonly string[]).includes(verse.verseKey);

/**
 * The openings as captions, ending where the passage begins.
 *
 * `basmalaWords` are 1:1's own words, so the basmala is drawn from the mushaf
 * page like any ayah; the isti'adha is not Quran text and has no page, so it is
 * drawn in the studio's Arabic face.
 */
export function openingVerses(
  heard: HeardOpening[] | undefined,
  passageStart: number,
  basmalaWords?: VerseWord[]
): VerseData[] {
  const openings = (heard || []).filter(
    opening => (OPENING_KINDS as readonly string[]).includes(opening.kind) && opening.start < passageStart
  );
  return openings.map((opening, i) => {
    const end = Math.min(passageStart, i + 1 < openings.length ? openings[i + 1].start : opening.end);
    const pageWords = opening.kind === 'basmala' && basmalaWords?.length === opening.words.length ? basmalaWords : null;
    const words: VerseWord[] = opening.words.map((word, w) => ({
      ...(pageWords ? pageWords[w] : { translation: '' }),
      arabic: word.text,
      timestamp: word.start
    }));
    return {
      verseNumber: 0,
      verseKey: opening.kind,
      textUthmani: opening.text,
      displayTextUthmani: opening.text,
      translation: TRANSLATION[opening.kind],
      startTime: opening.start,
      endTime: Math.max(opening.start, end),
      words
    };
  });
}

/**
 * The passage, its first caption starting where the openings were heard to
 * end when that is before where the aligner started it.
 *
 * The aligner can start the passage's first word late -- 0.7s on the studio's
 * own Al-Fatihah sample, where Al-Sudais's basmala begins at 3.6s and the
 * aligner put it at 4.3s -- while the isti'adha was heard to end in the pause
 * before it. Its card stayed up over the basmala.
 */
export function passageAfterOpenings<V extends { startTime: number }>(passage: V[], heard: HeardOpening[] | undefined): V[] {
  const first = passage[0];
  if (!first || !heard?.length) return passage;
  const end = Math.max(...heard.map(opening => opening.end));
  return end < first.startTime ? [{ ...first, startTime: end }, ...passage.slice(1)] : passage;
}
