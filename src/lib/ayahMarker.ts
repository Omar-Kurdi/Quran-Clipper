import type { VerseData } from './quranData';

/**
 * Where a caption shows its ayah's number: closing the ayah inside the Arabic,
 * as the mushaf does (`end`), in the gap between the Arabic and translation
 * cards (`between`, how every project made before this option was drawn), or
 * not at all.
 */
export type AyahNumberPlacement = 'end' | 'between' | 'hidden';

export const AYAH_NUMBER_PLACEMENTS: readonly AyahNumberPlacement[] = ['end', 'between', 'hidden'];

/** A saved project with no placement predates the option, and keeps the look it was made with. */
export const placementOf = (value: unknown): AyahNumberPlacement =>
  AYAH_NUMBER_PLACEMENTS.includes(value as AyahNumberPlacement) ? (value as AyahNumberPlacement) : 'between';

export const toArabicDigits = (n: number): string => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

/**
 * The end-of-ayah marker, ﴿٢١﴾, in the order an RTL line wants it. The
 * mushaf page faces have no digits or ornate brackets, and the caption's font
 * stack falls back to a Unicode Arabic face for them, so one string serves
 * every face.
 */
export const ayahMarker = (verseNumber: number): string => `﴿${toArabicDigits(verseNumber)}﴾`;

/** A token that is an end-of-ayah marker: wrapping keeps it on the line of the word it closes. */
export const AYAH_MARKER = /^﴿[٠-٩]+﴾$/;

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
