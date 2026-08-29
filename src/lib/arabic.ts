/**
 * Arabic text normalisation.
 *
 * The Quran text is fully vocalised Uthmani script; anything compared against
 * it -- a decoder's output, a user's edit -- is not. Collapsing both to a
 * common form is what makes them comparable.
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
