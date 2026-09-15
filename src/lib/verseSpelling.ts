/**
 * Verse-level Uthmani spelling, paired to the API's word list.
 *
 * quran.com serves the same verse twice over, and the two disagree. The
 * verse-level `text_uthmani` is the mushaf spelling; the per-word
 * `text_uthmani` writes some of the same sounds differently -- tanwin before
 * an assimilated consonant carries the small meem there (هُدًۭى for هُدًى), and
 * so on across 3525 of the 6236 verses. A caption must show the mushaf
 * spelling, so the verse-level text is the one to render.
 *
 * The word list cannot simply be dropped, though: it carries the per-word
 * translation, and its indices are what every timing, segment and ground-truth
 * file in the app refers to. So the verse is split back into words and paired
 * to that list one entry at a time, leaving the indices where they are and
 * changing only the spelling.
 */

// The aligner's comparison form, ported from `normalize_for_vocab` in
// `asr-service/app/align.py`. Deliberately not `normalizeArabic`, which folds
// ة/ه, ؤ/و and ئ/ي together as well: a looser comparison would let the search
// below settle for fewer tokens than the word actually spans.
const DIACRITICS = /[ً-ْٓ-ٰٕۖ-ۭـ]/g;

function skeleton(word: string): string {
  return word
    .replace(DIACRITICS, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^ء-ي]/g, '');
}

// One word in the Quran needs more than that. In 11:13 the word list spells
// ٱفْتَرَىٰهُ as افْتَرَاهُ -- the imlaei spelling, with the long ā written as a
// plain alef where the mushaf writes alef maqsura. Folding the two together
// pairs it, and measured over all 6236 verses this second pass fires on that
// word alone and changes no other verse's result.
const alefMaqsuraIsAlef = (word: string) => skeleton(word).replace(/ي/g, 'ا');

const LETTERS = /[ء-ي]/;

/**
 * Split a verse into recited words, mirroring `split_verse_words` in
 * `asr-service/app/corpus.py`.
 *
 * Uthmani script writes waqf, sajda and hizb marks as free-standing tokens.
 * They are notation, not words, and the API's word list drops them, so they
 * are glued onto a neighbouring word rather than counted. A mark *before* the
 * first word goes onto the word that follows -- 199 verses open with the hizb
 * mark ۞, and treating it as a word of its own puts every index in those
 * verses one too high.
 */
export function splitVerseWords(text: string): string[] {
  const words: string[] = [];
  let leading: string[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (LETTERS.test(token)) {
      words.push([...leading, token].join(' '));
      leading = [];
    } else if (words.length) {
      words[words.length - 1] = `${words[words.length - 1]} ${token}`;
    } else {
      leading.push(token);
    }
  }
  // A verse of nothing but notation cannot occur; never silently drop text.
  if (leading.length) words.push(leading.join(' '));
  return words;
}

/**
 * The verse-level spelling of each word in `apiWords`, or null if the two
 * cannot be paired.
 *
 * Returning null rather than a partial answer is the point: an off-by-one
 * pairing would put the wrong word under every following timing, which is far
 * worse than showing the word list's own spelling for that one verse. Every
 * verse pairs today; the null path is there for the day the upstream changes.
 */
export function pairVerseWords(apiWords: string[], verseText: string): string[] | null {
  const tokens = splitVerseWords(verseText);
  const paired: string[] = [];
  let at = 0;

  for (const word of apiWords) {
    let took = 0;
    // The word list joins two written tokens into one entry here and there, so
    // a word may span more than one: take the fewest that spell it.
    for (const same of [skeleton, alefMaqsuraIsAlef]) {
      for (let take = 1; at + take <= tokens.length; take++) {
        if (same(tokens.slice(at, at + take).join(' ')) === same(word)) {
          took = take;
          break;
        }
      }
      if (took) break;
    }
    if (!took) return null;
    paired.push(tokens.slice(at, at + took).join(' '));
    at += took;
  }

  // Short of the end means the pairing consumed the wrong tokens somewhere.
  return at === tokens.length ? paired : null;
}
