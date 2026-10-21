import type { VerseData } from './quranData';

/**
 * Where a caption shows its ayah's number: closing the ayah inside the Arabic
 * and its translation, as the mushaf does (`end`, the default), or in the gap
 * between the Arabic and translation cards (`between`).
 */
export type AyahNumberPlacement = 'end' | 'between';

export const AYAH_NUMBER_PLACEMENTS: readonly AyahNumberPlacement[] = ['end', 'between'];

/** Anything else -- a project saved before the option, or one that chose a placement no longer offered -- is the default. */
export const placementOf = (value: unknown): AyahNumberPlacement =>
  AYAH_NUMBER_PLACEMENTS.includes(value as AyahNumberPlacement) ? (value as AyahNumberPlacement) : 'end';

export const toArabicDigits = (n: number): string => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

/**
 * The end-of-ayah marker as the mushaf prints it: U+06DD, the end-of-ayah
 * sign, before the number's digits, which a mushaf face draws as one ornament
 * with the number inside it -- ۝٢١. It is drawn in a face of its own
 * (`VideoCanvas`), whatever the caption's.
 */
export const ayahMarker = (verseNumber: number): string => `\u06DD${toArabicDigits(verseNumber)}`;

/** A token that is an end-of-ayah marker: wrapping keeps it on the line of the word it closes. */
export const AYAH_MARKER = /^\u06DD[٠-٩]+$/;

/**
 * Whether a caption reaches its ayah's end, and so carries the marker: its
 * last word is in it. A long ayah split over captions shows the marker on the
 * part that ends it, and a repeat that stops mid-ayah shows none. With no
 * word list, a caption showing part of the ayah ends it when the ayah's text
 * ends with that part. An opening (verse 0) has no number.
 */
export function endsAyah(verse: Pick<VerseData, 'verseNumber' | 'words' | 'textUthmani' | 'displayTextUthmani'>): boolean {
  if (!(verse.verseNumber > 0)) return false;
  if (verse.words?.length) return !verse.words[verse.words.length - 1].excluded;
  const shown = verse.displayTextUthmani?.trim();
  return !shown || verse.textUthmani.trim().endsWith(shown);
}
