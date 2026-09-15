/**
 * The mushaf's own fonts, and how a page of one gets in front of the user.
 *
 * Two kinds of Arabic face are on offer and they are not interchangeable.
 *
 * A **Unicode** face draws `word.arabic`, letter by mark, the way any font
 * draws any text. Which marks appear is then the font's decision, and the
 * fonts disagree: on `مِنْ` the sukun is a closed ring in Scheherazade New,
 * KFGQPC Hafs and Amiri, and an open head in Digital Khatt -- and the printed
 * mushaf does not draw one there at all.
 *
 * A **page** face settles that by not rendering text. The King Fahd Complex
 * typesets each of the 604 pages by hand; QUL publishes each page as a font in
 * which every word on it is a single glyph, addressed by a private-use
 * codepoint the upstream sends as `code_v2`. Drawing those glyphs reproduces
 * the printed page exactly, because it *is* the printed page.
 *
 * The cost is that a glyph is not text: it cannot be searched, edited,
 * compared or aligned. So `word.glyph` is for pixels only and `word.arabic`
 * remains the text everywhere else -- see `VerseWord`.
 *
 * The fonts are not in the repo. `scripts/qul-import.mjs` unpacks them out of
 * the QUL archives into `public/fonts/`, so a clone that has not run it has
 * none, and everything here has to degrade rather than show empty boxes.
 */

/** The page-glyph face: the mushaf as printed, and the studio's default. */
export const QPC_V2 = 'qpc-v2';

/** One font per mushaf page, so the family name carries the page. */
export const qpcPageFamily = (page: number) => `qpc-p${page}`;
export const qpcPageUrl = (page: number) => `/fonts/qcf/p${page}.woff2`;

export const SURAH_NAME_FAMILY = 'surah-name-v4';

/**
 * The face to draw with when the chosen one cannot serve.
 *
 * Every caption needs some family behind it: a page font that has not arrived,
 * a caption straddling a page break, a translation in the Arabic script. This
 * is that face -- chosen because it is the one Unicode face measured to draw
 * both the sukun and the silent-letter zero correctly.
 */
export const FALLBACK_ARABIC_FAMILY = 'DigitalKhatt New Madina';

/**
 * What to write to get a surah's name from the surah-name face.
 *
 * The font holds no Arabic: it maps ASCII, and a ligature turns the written
 * string into one calligraphic glyph. The number is padded to three digits --
 * `surah9` produces nothing, `surah009` produces At-Tawbah's name. QUL ships
 * this rule as `ligatures.json`; it is one line, so it lives here instead.
 */
export const surahNameText = (surah: number) => `surah${String(surah).padStart(3, '0')}`;

/** Which page fonts a set of words needs, in order, without repeats. */
export function pagesUsedBy(words: { glyph?: string; glyphPage?: number }[] = []): number[] {
  const pages: number[] = [];
  for (const word of words) {
    // A verse can straddle a page break, so this is per word and never per
    // verse: 2:282 ends one page and the ayah after it begins the next.
    if (word.glyph && word.glyphPage && !pages.includes(word.glyphPage)) pages.push(word.glyphPage);
  }
  return pages;
}

/** True when every word on screen can be drawn from the page fonts. */
export function canDrawAsMushaf(words: { glyph?: string; glyphPage?: number }[] = []): boolean {
  return words.length > 0 && words.every(word => Boolean(word.glyph && word.glyphPage));
}

/**
 * The printed page's drawing of one caption, or null to use the Unicode text.
 *
 * Glyphs are space-separated characters, so a caller can wrap, measure and
 * draw the returned string exactly as it draws Arabic text -- only the family
 * changes. That is the whole reason this returns a string rather than a list
 * of per-word runs.
 *
 * Null when the mushaf cannot draw this caption, and the caller falls back:
 * the reader chose a Unicode face; the upstream sent no glyphs; or the caption
 * straddles a page break, where two families would be needed for one line and
 * a single `ctx.font` cannot supply both.
 */
export function mushafCaption(
  words: { glyph?: string; glyphPage?: number; excluded?: boolean }[] | undefined,
  fontId: string
): { text: string; family: string } | null {
  if (fontId !== QPC_V2 || !words?.length) return null;
  const shown = words.filter(word => !word.excluded);
  if (!canDrawAsMushaf(shown)) return null;
  const pages = pagesUsedBy(shown);
  if (pages.length !== 1) return null;
  return { text: shown.map(word => word.glyph).join(' '), family: qpcPageFamily(pages[0]) };
}

/**
 * Make sure the browser has the page fonts these words need.
 *
 * There are 604 of them, one per printed page, so they cannot sit in CSS: each
 * is added to `document.fonts` by hand the first time a word on that page is
 * shown. `document.fonts` is per document, not per component, so whichever
 * view asks first pays for it and the rest find it already there.
 *
 * Never rejects. A clone that has not run `scripts/qul-import.mjs` has no
 * fonts at all, and the caller draws `word.arabic` in a Unicode face instead
 * -- which is the whole degradation path, and why nothing here throws.
 */
export async function ensureQpcPages(pages: number[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return;
  const have = new Map<string, FontFace>();
  document.fonts.forEach(face => have.set(face.family, face));
  await Promise.all(pages.map(page => {
    const family = qpcPageFamily(page);
    const existing = have.get(family);
    const face = existing || new FontFace(family, `url(${qpcPageUrl(page)}) format('woff2')`);
    if (!existing) document.fonts.add(face);
    if (face.status === 'loaded') return Promise.resolve();
    return face.load().then(() => undefined, () => undefined);
  }));
}

/** How to show one word: the mushaf's glyph where there is one, else the text. */
export function wordFace(word: { arabic: string; glyph?: string; glyphPage?: number }):
  { text: string; family?: string } {
  return word.glyph && word.glyphPage
    ? { text: word.glyph, family: qpcPageFamily(word.glyphPage) }
    : { text: word.arabic };
}
