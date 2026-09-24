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
 * *Where* a mark appears is the font's decision too, and the waqf signs are
 * the worst of it. Uthmani script writes them as free-standing tokens
 * (`مُتَشَـٰبِهَـٰتٌ ۖ`), and they are combining marks with no width, so the only base
 * in front of them is the space -- which no font has anchor data for. Measured
 * at 60px on `3:7`: Digital Khatt drops the sign onto the last letter, AlQuran
 * IndoPak flings it clear of the word and above the line, and none of them put
 * it where the mushaf prints it. No Unicode face can be asked to do better,
 * because the text does not say where it goes.
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

/** One row of a caption as the mushaf prints it: its glyphs, in the family of the page it is on. */
export interface MushafRow {
  text: string;
  family: string;
}

/**
 * The caption broken where the printed page breaks it, or null to wrap.
 *
 * Consecutive shown words that share a page and a line are one row. Each row
 * carries its own page's family, which is also what lets a caption that runs
 * across a page break be drawn from the page fonts at all: a single line of
 * the mushaf is never on two pages, so no row ever needs two families.
 *
 * Null when the mushaf face is not chosen or any shown word lacks its glyph,
 * page or line -- the caller then wraps by width, as it always has.
 */
export function mushafRows(
  words: { glyph?: string; glyphPage?: number; glyphLine?: number; excluded?: boolean }[] | undefined,
  fontId: string
): MushafRow[] | null {
  if (fontId !== QPC_V2 || !words?.length) return null;
  const shown = words.filter(word => !word.excluded);
  if (!canDrawAsMushaf(shown) || !hasLines(shown)) return null;
  const rows: { page: number; line: number; glyphs: string[] }[] = [];
  for (const word of shown) {
    const last = rows[rows.length - 1];
    if (last && last.page === word.glyphPage && last.line === word.glyphLine) last.glyphs.push(word.glyph!);
    else rows.push({ page: word.glyphPage!, line: word.glyphLine!, glyphs: [word.glyph!] });
  }
  return rows.map(row => ({ text: row.glyphs.join(' '), family: qpcPageFamily(row.page) }));
}

/**
 * How to show one word: the mushaf's glyph where there is one, else the text.
 * `glyphs` is false where the page fonts are not installed, since a glyph
 * without its page's font is an empty box.
 */
export function wordFace(word: { arabic: string; glyph?: string; glyphPage?: number }, glyphs = true):
  { text: string; family?: string } {
  return glyphs && word.glyph && word.glyphPage
    ? { text: word.glyph, family: qpcPageFamily(word.glyphPage) }
    : { text: word.arabic };
}

/** A word as far as the page glyphs are concerned. */
type Glyphable = { glyph?: string; glyphPage?: number; glyphLine?: number };

/** Whether every word also knows its printed line, which `mushafRows` needs. */
const hasLines = (words: Glyphable[] = []) => words.length > 0 && words.every(word => Boolean(word.glyphLine));

/**
 * Fill in the page glyphs a timeline arrived without.
 *
 * Two timelines reach the studio with none. The opening sample carries ayah
 * text and timings but no word list at all, and a project saved before the
 * page fonts existed carries words that have no `glyph`. Either way
 * `canDrawAsMushaf` is false, the mushaf face falls back to the Unicode one --
 * which is the face the Digital Khatt option already uses -- and so choosing
 * between those two appears to do nothing while the caption is drawn by that
 * font's rules rather than the printed page's. The reader picked the mushaf
 * and did not get it.
 *
 * Only the missing glyphs are filled. Timings, translations, exclusions and
 * the saved spelling are left exactly as they were: this repairs how a word is
 * *drawn*, never what it says. An ayah whose saved word count no longer
 * matches the upstream's is left alone rather than paired off by one, and the
 * array comes back by identity when nothing changed, so a caller may run this
 * on every render without looping.
 */
export function withGlyphs<W extends Glyphable, V extends { verseKey: string; words?: W[] }>(
  verses: V[],
  fetched: { verseKey: string; words?: W[] }[]
): V[] {
  const source = new Map(fetched.map(verse => [verse.verseKey, verse.words || []]));
  let changed = false;

  const filled = verses.map(verse => {
    const from = source.get(verse.verseKey);
    if (!from?.length || (canDrawAsMushaf(verse.words) && hasLines(verse.words))) return verse;

    // No word list of its own: the fetched one is the only one there is.
    if (!verse.words?.length) {
      changed = true;
      return { ...verse, words: from };
    }
    // One entry per recited word in both, or the pairing is a guess.
    if (verse.words.length !== from.length) return verse;

    let filledHere = false;
    const words = verse.words.map((word, index) => {
      const { glyph, glyphPage, glyphLine } = from[index];
      // Nothing to copy is not a change. Writing `glyph: undefined` onto the
      // word would rebuild the list for no gain, and the key would then be
      // saved into the project the next time it is written out.
      const needsGlyph = !(word.glyph && word.glyphPage) && glyph && glyphPage;
      // A line only belongs with the glyph it was printed as.
      const needsLine = !word.glyphLine && glyphLine && (needsGlyph || word.glyphPage === glyphPage);
      if (!needsGlyph && !needsLine) return word;
      filledHere = true;
      return {
        ...word,
        ...(needsGlyph ? { glyph, glyphPage } : {}),
        ...(needsLine ? { glyphLine } : {})
      };
    });
    if (!filledHere) return verse;
    changed = true;
    return { ...verse, words };
  });

  return changed ? filled : verses;
}

/**
 * A token of nothing but combining marks, which cannot begin a line.
 *
 * Uthmani script writes the waqf signs as free-standing tokens --
 * `مُتَشَـٰبِهَـٰتٌ ۖ` is one word and one mark, with a space between them, and the
 * word list keeps them that way. They have no width of their own, so a break
 * in that space would carry the mark to the next line and draw it over that
 * line's first word, saying "you may stop here" where the mushaf does not.
 *
 * Nor is it drawn after that space. A mark on a space has no letter to sit on,
 * no Unicode face carries anchors for it, and each guesses: Digital Khatt set
 * ۚ on the baseline as if it were a letter, and the Nastaleeq face threw it
 * clear of the word and above the line. Joined to the word before it, each
 * face places it the way the mushaf prints it -- raised, just past the end of
 * that word. Only the space goes, and only in what is drawn: the characters
 * are the upstream's, and the word list keeps its spelling.
 *
 * Only Unicode text can produce such a token. A page glyph is a private-use
 * character, so a mushaf caption never matches and wraps exactly as before.
 *
 * The non-spacing marks only. `۞` and `۩` are free-standing tokens too, but
 * they are drawn symbols with a width of their own and may begin a line.
 */
const MARK_ONLY = /^[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]+$/;

/**
 * Wrap one caption to `limit`, greedily, dropping nothing.
 *
 * A word too wide for the card still gets its own line; the caller's
 * shrink-to-fit search then reduces the type until even that line fits, which
 * is what keeps a long ayah from being silently cut.
 */
export function wrapCaption(
  text: string,
  limit: number,
  measure: (line: string) => number
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const mark = MARK_ONLY.test(token);
    const test = line ? `${line}${mark ? '' : ' '}${token}` : token;
    if (line && !mark && measure(test) > limit) {
      lines.push(line);
      line = token;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
