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

/**
 * How the end-of-ayah marker is drawn: the ornament with the number inside
 * (`medallion`, the default), the mushaf page's own end glyph where the
 * caption is drawn from the page faces (`page`), the number between ornate
 * brackets (`brackets`), the number alone (`plain`), or the number in a ring
 * (`circle`). Whatever the style, the caption carries the same `ayahMarker`
 * token, so wrapping and fitting see one marker; only its drawing differs.
 */
export type AyahMarkerStyle = 'medallion' | 'page' | 'brackets' | 'plain' | 'circle';

export const AYAH_MARKER_STYLES: readonly AyahMarkerStyle[] = ['medallion', 'page', 'brackets', 'plain', 'circle'];

/** Anything else -- a project saved before the option -- is the medallion it was drawn with. */
export const markerStyleOf = (value: unknown): AyahMarkerStyle =>
  AYAH_MARKER_STYLES.includes(value as AyahMarkerStyle) ? (value as AyahMarkerStyle) : 'medallion';

/** The number in an `ayahMarker` token, in Arabic digits. */
export const markerDigits = (marker: string): string => marker.replace(/^۝/, '');

/**
 * The page face's own end-of-ayah glyph for a caption ending on `words`, and
 * the page whose font draws it. A page font numbers its glyphs in reading
 * order, the ayah's end among them, so the end is the code after its last
 * word's last glyph -- checked against the upstream's own end glyphs for all
 * 513 ayahs of 2, 18, 36, 67 and 112. Null when the words carry no glyphs.
 */
export function pageEndGlyph(words: { glyph?: string; glyphPage?: number }[] | undefined): { glyph: string; page: number } | null {
  const last = words?.[words.length - 1];
  if (!last?.glyph || !last.glyphPage) return null;
  const code = last.glyph.codePointAt(last.glyph.length - 1);
  return code === undefined ? null : { glyph: String.fromCodePoint(code + 1), page: last.glyphPage };
}
