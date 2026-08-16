/**
 * Arabic text normalisation shared by the Gemini and ASR matchers.
 *
 * ASR output is undiacritised and orthographically loose, while the Quran text
 * is fully vocalised Uthmani script. Comparing them requires collapsing both
 * to a common skeleton.
 */

const DIACRITICS = /[\u064B-\u0652\u0653-\u0655\u0670\u06D6-\u06ED\u0640]/g;

/** Strip harakat/tanwin/superscript-alef/tatweel and unify letter variants. */
export function normalizeArabic(input = ''): string {
  return input
    .replace(DIACRITICS, '')
    .replace(/[إأٱآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A harsher normalisation used only for fuzzy word comparison.
 *
 * Drops the definite article and word-final long vowels, which ASR models drop
 * or hallucinate constantly (waqf vs. wasl endings). Never use this for text
 * that will be displayed.
 */
export function skeletonize(word: string): string {
  const base = normalizeArabic(word).replace(/\s+/g, '');
  if (!base) return '';
  const withoutArticle = base.length > 3 && base.startsWith('ال') ? base.slice(2) : base;
  return withoutArticle.replace(/[اويه]+$/u, '') || withoutArticle;
}

export function tokenize(input = ''): string[] {
  const normalized = normalizeArabic(input);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** Levenshtein distance with an early-exit ceiling. */
export function editDistance(a: string, b: string, ceiling = Infinity): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > ceiling) return ceiling + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > ceiling) return ceiling + 1;
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

/** Word similarity in [0, 1], tolerant of the endings ASR routinely mangles. */
export function wordSimilarity(a: string, b: string): number {
  return skeletonSimilarity(skeletonize(a), skeletonize(b));
}

/**
 * Same as `wordSimilarity`, but takes already-skeletonized strings. Use this
 * in hot loops (e.g. aligning against the full Quran corpus) where the same
 * words get compared many times over — skeletonizing once up front instead
 * of on every comparison is the difference between a fast and a slow search.
 */
export function skeletonSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const longest = Math.max(left.length, right.length);
  const distance = editDistance(left, right, Math.ceil(longest / 2));
  return Math.max(0, 1 - distance / longest);
}
