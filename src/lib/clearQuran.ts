/**
 * The Clear Quran, read from a file on this machine.
 *
 * Quran.com publishes Dr. Mustafa Khattab's translation as resource 131, but
 * only through the Quran Foundation's content API, and the credentials here
 * reach the pre-live sandbox rather than the live one -- which is why asking
 * for 131 has always quietly fallen back to Saheeh International. Until that
 * access arrives, the same edition is served from `data/quran/english.json`,
 * fetched from quranapi.pages.dev.
 *
 * It keeps quran.com's id. The id names the *edition*, not where the bytes
 * came from, so a project saved today still means The Clear Quran if the
 * Foundation later starts answering for 131 -- at which point this file simply
 * stops being reached.
 *
 * Server side only. The file is 5.9 MB; importing it anywhere the client can
 * reach would put all of it in the bundle, and it is a copyrighted translation
 * that has no business being a static asset.
 *
 * On what it is: the payload carries no name, translator or licence -- it is
 * just 114 objects of text. The edition was identified by its fingerprint,
 * which is unambiguous: Khattab marks interpolated words with ornate half
 * brackets, and there are 5,773 of them, in the places his edition puts them
 * ("You ˹alone˺ we worship"). 6,236 ayahs, matching the standard numbering the
 * rest of the studio uses, so verse keys line up with no mapping.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Quran.com's resource id for this edition, which is what a project stores. */
export const CLEAR_QURAN_ID = '131';

/** As quran.com names it, so the picker and the caption credit agree with it. */
export const CLEAR_QURAN_NAME = 'Dr. Mustafa Khattab, the Clear Quran';

/**
 * Repairs of this particular copy, which is not clean.
 *
 * Every character below was measured against the studio's own faces rather
 * than guessed at: rendered into a canvas in Inter, Amiri and the system
 * default, and compared with a private-use codepoint that no font has. Four
 * came back identical to that -- a tofu box, in every face, which is what
 * would have been drawn into the video and baked into the export.
 *
 *   U+02F9 / U+02FA  the ornate half brackets, 5,773 and 5,772 of them.
 *   U+0202  `Ȃ`, 14 of them, all in `’Ȃd` and `Ȃzar`.
 *   U+2C6B  `Ⱬ`, 5 of them, all in `Ⱬul-Qarnain` and `Ⱬul-Kifl`.
 *
 * The last two are damage in this copy rather than anything Khattab wrote:
 * the file spells the same name both ways, carrying `Â` (U+00C2) eleven times
 * beside the fourteen `Ȃ`, and carries the lower-case `ẓ` while every capital
 * became `Ⱬ`. They are put back to the letters the rest of the file already
 * uses.
 *
 * The brackets are a judgement rather than a repair, and worth stating: they
 * become `[` and `]`, which every face has. That is the same convention Saheeh
 * International uses for the same purpose, and which this studio therefore
 * already displays -- "[All] praise is [due] to Allāh". The marked words are
 * untouched; only the marks around them change shape. Doing nothing would have
 * put two tofu boxes in the middle of Al-Fatihah 1:5, which is the studio's own
 * sample verse and the first frame anyone sees.
 *
 * A non-breaking space is not a rendering problem but is a wrapping one: 1,037
 * of them sit mid-sentence where nothing needs holding together, and the
 * canvas breaks lines on spaces.
 */
// Written as escapes, not as the characters themselves. Three of the five are
// invisible or near-invisible in an editor -- a non-breaking space looks
// exactly like a space, and `Ȃ` looks exactly like `Â` -- so spelling them out
// is what makes this table reviewable.
const REPAIRS: [RegExp, string][] = [
  [/\u02F9/g, '['],       // ˹  begin high tone -> opening bracket
  [/\u02FA/g, ']'],       // ˺  end high tone   -> closing bracket
  [/\u0202/g, '\u00C2'],  // Ȃ  A inverted breve -> Â  A circumflex
  [/\u2C6B/g, '\u1E92'],  // Ⱬ  Z with descender -> Ẓ  Z with dot below
  [/\u00A0/g, ' '],       // no-break space -> space
];

export function normaliseClearQuran(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPAIRS) out = out.replace(pattern, replacement);
  return out.trim();
}

interface RawSurah {
  surahNo?: number;
  totalAyah?: number;
  translation?: string[];
}

/**
 * Ayah text by surah, or `null` when the file is not on this machine.
 *
 * Read once and reduced on the way in: the file is mostly audio urls for
 * reciters this studio does not use, and keeping only the translations holds
 * about 0.9 MB rather than 5.9. `null` is cached too -- a missing file will
 * still be missing on the next request, and re-reading to discover that on
 * every verse load is a cost for nothing.
 */
let cached: Record<number, string[]> | null | undefined;

function load(): Record<number, string[]> | null {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), 'data', 'quran', 'english.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RawSurah[];
    const bySurah: Record<number, string[]> = {};
    for (const surah of parsed) {
      if (typeof surah?.surahNo !== 'number' || !Array.isArray(surah.translation)) continue;
      // A surah whose text does not match its own ayah count would put every
      // caption after the gap against the wrong verse, which is worse than
      // having no translation at all.
      if (surah.totalAyah !== undefined && surah.translation.length !== surah.totalAyah) continue;
      bySurah[surah.surahNo] = surah.translation.map(normaliseClearQuran);
    }
    cached = Object.keys(bySurah).length ? bySurah : null;
  } catch {
    // Not installed on this machine. Every caller treats that as "this
    // translation is not available here" and falls back to the upstream.
    cached = null;
  }
  return cached;
}

export const clearQuranAvailable = (): boolean => load() !== null;

/** The whole surah, ayah 1 first. */
export function clearQuranSurah(surah: number): string[] | null {
  return load()?.[surah] ?? null;
}

/** One ayah by its 1-based number, or `''` when it is not held. */
export function clearQuranAyah(surah: number, ayah: number): string {
  return clearQuranSurah(surah)?.[ayah - 1] ?? '';
}
