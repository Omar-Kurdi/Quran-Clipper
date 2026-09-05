/**
 * Which translations a clip shows.
 *
 * The studio was fixed to one: Saheeh International, in English, baked into
 * the field named `translation` on every caption. That is the right default
 * and the wrong only option -- the audience for a recitation clip is rarely
 * monolingual, and "English and Urdu together" is an ordinary thing to want
 * rather than an advanced feature.
 *
 * The shape that makes it cheap: a caption keeps its `translation` exactly as
 * before and gains a `translations` map keyed by quran.com's resource id.
 * Nothing that reads the old field breaks, a project saved before this loads
 * unchanged, and the canvas asks this module what to draw rather than reading
 * either field directly.
 */

/**
 * The id that a caption's own `translation` field already holds.
 *
 * Saheeh International (20) on the open API, because that is what the open API
 * has; The Clear Quran (131) needs Quran Foundation credentials, and the
 * server picks it automatically once they are set -- see `quranApi.ts`. The
 * browser cannot read those, so the same value is published here as
 * `NEXT_PUBLIC_QURAN_TRANSLATION_ID`, and the two are meant to be set
 * together. Get it wrong and nothing breaks: the id simply becomes one more
 * translation to fetch by id, like any other.
 */
export const DEFAULT_TRANSLATION_ID =
  (process.env.NEXT_PUBLIC_QURAN_TRANSLATION_ID || '').trim() || '20';

/**
 * How many can be on screen at once.
 *
 * Not a technical limit. The card fits the text by shrinking it, so a fourth
 * translation does not overflow -- it makes all four unreadable, which is
 * worse, because it looks like it worked.
 */
export const MAX_TRANSLATIONS = 3;

export interface TranslationOption {
  /** quran.com resource id, as a string -- it is used as an object key throughout. */
  id: string;
  /** What the translation is called: usually the translator, sometimes the edition. */
  name: string;
  /** The language it is in, capitalised for display. */
  language: string;
  /** Set for languages written right to left, which the picker marks. */
  rtl: boolean;
}

/**
 * Languages written right to left.
 *
 * Used for labelling the picker only. What the canvas actually draws is
 * decided by looking at the text -- see `isRtlText` -- because a caption has
 * to lay itself out during an export, where no catalogue has been loaded.
 */
const RTL_LANGUAGES = new Set([
  'arabic', 'urdu', 'persian', 'farsi', 'pashto', 'kurdish', 'sindhi',
  'uyghur', 'hebrew', 'divehi', 'dhivehi', 'kashmiri', 'balochi', 'baloch'
]);

export const isRtlLanguage = (language: string): boolean =>
  RTL_LANGUAGES.has(language.trim().toLowerCase());

/** Arabic, Urdu, Persian, Pashto, Sindhi, Uyghur -- one script, and Hebrew beside it. */
const RTL_SCRIPT = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;

/** True when this text is written right to left, judged by the script it is in. */
export const isRtlText = (text: string): boolean => RTL_SCRIPT.test(text);

/** `english` -> `English`, leaving names that are already capitalised alone. */
export const displayLanguage = (language: string): string =>
  language ? language.charAt(0).toUpperCase() + language.slice(1) : language;

/**
 * Adds or removes a translation, keeping at least one and at most `max`.
 *
 * Removing the last one would leave a card with an Arabic line and nothing
 * under it, reachable only by turning translations off -- which is a different
 * control, and the one that says what it does.
 */
export function toggleTranslation(
  ids: string[],
  id: string,
  max: number = MAX_TRANSLATIONS
): string[] {
  if (ids.includes(id)) {
    if (ids.length === 1) return ids;
    return ids.filter(current => current !== id);
  }
  if (ids.length >= max) return ids;
  return [...ids, id];
}

/** The selected ids as options, in the order they were chosen; unknown ids keep their place. */
export function selectedOptions(ids: string[], catalogue: TranslationOption[]): TranslationOption[] {
  return ids.map(
    id => catalogue.find(option => option.id === id) ?? { id, name: id, language: '', rtl: false }
  );
}

export interface LanguageGroup {
  language: string;
  options: TranslationOption[];
}

/**
 * The catalogue by language, English first and the rest alphabetical.
 *
 * quran.com returns roughly 130 translations in one flat list, several per
 * language; ungrouped, choosing between four Urdu translators means reading
 * the whole list to find out that there are four.
 */
export function groupByLanguage(catalogue: TranslationOption[]): LanguageGroup[] {
  const groups = new Map<string, TranslationOption[]>();
  for (const option of catalogue) {
    const key = option.language || 'Other';
    const list = groups.get(key);
    if (list) list.push(option);
    else groups.set(key, [option]);
  }
  return [...groups.entries()]
    .map(([language, options]) => ({
      language,
      options: [...options].sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => {
      if (a.language === b.language) return 0;
      if (a.language === 'English') return -1;
      if (b.language === 'English') return 1;
      return a.language.localeCompare(b.language);
    });
}

/** Narrows the catalogue by translator, language or id, as typed. */
export function searchTranslations(catalogue: TranslationOption[], query: string): TranslationOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return catalogue;
  return catalogue.filter(
    option =>
      option.name.toLowerCase().includes(needle) ||
      option.language.toLowerCase().includes(needle) ||
      option.id === needle
  );
}

export interface CaptionSource {
  translation?: string;
  /** What this caption shows for the default translation, when it was edited or split. */
  displayTranslation?: string;
  /** Extra translations for the whole ayah, keyed by resource id. */
  translations?: Record<string, string>;
}

export interface CaptionTranslation {
  id: string;
  text: string;
  rtl: boolean;
}

/**
 * What one caption puts under its Arabic, in the order chosen.
 *
 * The default translation keeps coming from the caption's own fields, which is
 * what makes a hand-edited or split caption show the words it actually covers.
 * The others are whole-ayah text: splitting an ayah cannot split a translation
 * nobody has aligned, and inventing a division would be worse than showing the
 * ayah's own sentence.
 */
export function captionTranslations(verse: CaptionSource, ids: string[]): CaptionTranslation[] {
  const wanted = ids.length ? ids : [DEFAULT_TRANSLATION_ID];
  const out: CaptionTranslation[] = [];
  for (const id of wanted) {
    const text =
      id === DEFAULT_TRANSLATION_ID
        ? verse.displayTranslation || verse.translation || verse.translations?.[id] || ''
        : verse.translations?.[id] || '';
    const trimmed = text.trim();
    if (!trimmed) continue;
    out.push({ id, text: trimmed, rtl: isRtlText(trimmed) });
  }
  return out;
}

/** Which of the wanted translations a set of captions is still missing. */
export function missingTranslationIds(
  verses: { verseKey: string; translations?: Record<string, string> }[],
  ids: string[]
): string[] {
  return ids.filter(
    id =>
      id !== DEFAULT_TRANSLATION_ID &&
      verses.some(verse => !verse.translations?.[id])
  );
}
