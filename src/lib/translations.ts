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

/**
 * Names the studio knows without asking, for the moment before the catalogue
 * has loaded.
 *
 * The panel used to print one hardcoded name here -- "Saheeh International" --
 * on the reasoning that it was the default and therefore what an unnamed
 * default must be. That stopped being true the moment the default moved, and
 * it failed silently: the chip named one translation while the card underneath
 * drew another. Keyed by id, so it is wrong for nobody.
 *
 * Only the two the studio ships a default for. Anything else is named by the
 * catalogue or shown as its own id, which is at least not a claim.
 */
const KNOWN_NAMES: Record<string, string> = {
  '20': 'Saheeh International',
  '131': 'Dr. Mustafa Khattab, the Clear Quran'
};

/** A name for `id` without the catalogue: a known one, else the id itself. */
export const knownTranslationName = (id: string): string => KNOWN_NAMES[id] || id;

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

/**
 * The word-by-word gloss dataset the studio draws, named as it names itself.
 *
 * quran.com publishes exactly one English word-by-word edition -- id 59,
 * `author_name: "Unknown"` in their own catalogue -- and it is a separate work
 * from every prose translation in the picker. Naming a chosen translator over
 * it puts their name to words that are not theirs, which is what the panel was
 * doing: it labelled a box "Dr. Mustafa Khattab, the Clear Quran" and drew
 * "Miserly towards you", a phrase that appears nowhere in that translation.
 *
 * The language is English because both fetch paths ask for it -- see
 * `language=en` in `quranCorpus.ts` and `/api/quran/verses`. If that ever
 * becomes a choice, this is the constant that has to follow it.
 */
export const WORD_BY_WORD_LANGUAGE = 'English';
export const WORD_BY_WORD_PROVIDER = 'quran.com';

/**
 * Where the text in a translation slot came from.
 *
 * Carried alongside the text because the label depends on it: a hand
 * correction is the user's own words for that edition and keeps the edition's
 * name, while the gloss line belongs to a different work and has to say so.
 */
export type CaptionTextSource = 'correction' | 'words' | 'fetched' | 'none';

export interface CaptionSource {
  translation?: string;
  /** What this caption shows for the default translation, when it was edited or split. */
  displayTranslation?: string;
  /** Extra translations for the whole ayah, keyed by resource id. */
  translations?: Record<string, string>;
  /** Hand corrections to those, which win over the fetched text. */
  displayTranslations?: Record<string, string>;
  /**
   * The ayah's words, each with its own gloss.
   *
   * Read only when the caption is asked to follow the word mask -- see
   * `wordByWord` below.
   */
  words?: { translation?: string; excluded?: boolean }[];
}

export interface CaptionTranslation {
  id: string;
  text: string;
  rtl: boolean;
  /** Where this line came from, so a caller can say whose words it is drawing. */
  source: CaptionTextSource;
}

/**
 * The English of just the words this caption is showing.
 *
 * A caption covering half an ayah still carried the whole ayah's translation,
 * so the line underneath said things that were never recited. The word list is
 * already per-word and already carries the mask -- the chips in the ayah panel
 * are that mask -- so the glosses of the visible words are exactly the English
 * of what is on screen.
 *
 * What comes out is a gloss line rather than prose: "Say He (is) Allah the
 * One". That is inherent to word-by-word and is why this is a choice rather
 * than the default -- for a caption showing a whole ayah, the translator's
 * sentence reads far better than its words in a row.
 *
 * Empty when the words carry no glosses at all, so the caller can fall back
 * rather than draw a blank line.
 */
export function wordByWordTranslation(
  words: { translation?: string; excluded?: boolean }[] | undefined
): string {
  return (words || [])
    .filter(word => !word.excluded)
    .map(word => (word.translation || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * The text one translation slot shows, by the one order of precedence.
 *
 * Exported so every place that draws a translation goes through it. They did
 * not, twice over, and both times the panel and the card disagreed:
 *
 *   - the ayah panel's box read `displayTranslation || translation` directly,
 *     so with the word mask on, hiding a word changed the video and left the
 *     box showing the whole ayah;
 *   - the mask itself was applied to the caption's own translation only, so a
 *     second or third language went on drawing the whole ayah's sentence
 *     underneath two Arabic words.
 *
 * The order, for any slot: a hand correction, then the word-by-word line when
 * the mask is being followed, then the fetched text. A correction is someone's
 * own words and outranks anything generated, including the glosses.
 *
 * `id` picks where the fetched text comes from. `DEFAULT_TRANSLATION_ID` is the
 * caption's own `translation` field -- the one every project started with --
 * and everything else is looked up in `translations`.
 */
export function captionText(
  verse: CaptionSource,
  id: string,
  wordByWord = false
): { text: string; source: CaptionTextSource } {
  const isOwn = id === DEFAULT_TRANSLATION_ID;
  const correction = (isOwn ? verse.displayTranslation : verse.displayTranslations?.[id]) || '';
  if (correction.trim()) return { text: correction, source: 'correction' };

  // One dataset, not one per edition: quran.com publishes a single word-by-word
  // English, so every slot that follows the mask resolves to the same line.
  // `captionTranslations` collapses the repeats rather than stacking them.
  if (wordByWord) {
    const glosses = wordByWordTranslation(verse.words);
    if (glosses) return { text: glosses, source: 'words' };
  }

  const fetched = isOwn
    ? verse.translation || verse.translations?.[DEFAULT_TRANSLATION_ID]
    : verse.translations?.[id];
  return fetched ? { text: fetched, source: 'fetched' } : { text: '', source: 'none' };
}

/** The text alone, for the callers that do not care where it came from. */
export function captionTextFor(verse: CaptionSource, id: string, wordByWord = false): string {
  return captionText(verse, id, wordByWord).text;
}

/** The caption's own translation slot, which is what the first box edits. */
export function primaryCaptionText(verse: CaptionSource, wordByWord = false): string {
  return captionTextFor(verse, DEFAULT_TRANSLATION_ID, wordByWord);
}

/**
 * What one caption puts under its Arabic, in the order chosen.
 *
 * Each slot resolves through `captionTextFor`, so the mask reaches all of them
 * rather than the first. A language whose text has not arrived yet is absent
 * rather than blank, so the card never reserves space for nothing.
 */
export function captionTranslations(
  verse: CaptionSource,
  ids: string[],
  /** Build every translation from the visible words rather than the ayah. */
  wordByWord = false
): CaptionTranslation[] {
  const wanted = ids.length ? ids : [DEFAULT_TRANSLATION_ID];
  const out: CaptionTranslation[] = [];
  // Two editions of the same language resolve to one word-by-word line, and
  // stacking a line on top of itself is not a second translation -- it is the
  // card saying the same thing twice in a smaller font.
  const drawn = new Set<string>();
  for (const id of wanted) {
    const { text, source } = captionText(verse, id, wordByWord);
    const trimmed = text.trim();
    if (!trimmed || drawn.has(trimmed)) continue;
    drawn.add(trimmed);
    out.push({ id, text: trimmed, rtl: isRtlText(trimmed), source });
  }
  return out;
}

/**
 * The ids whose own text these captions actually draw.
 *
 * Chosen is not drawn. With the word mask on, the card shows quran.com's
 * word-by-word glosses -- a separate work from every translation in the picker
 * -- and identical gloss lines collapse into one, so a chosen translation can
 * end up contributing nothing to the video. Crediting its translator then names
 * someone over words the clip does not contain, which is the same false
 * attribution as naming them over the glosses, pointing the other way.
 *
 * A slot showing a hand correction survives the collapse and counts as drawn:
 * it is a correction *to* that edition, and it is on screen.
 *
 * Returned in the chosen order, so a credit reads in the order the card stacks.
 */
export function drawnTranslationIds(
  verses: CaptionSource[],
  ids: string[],
  wordByWord = false
): string[] {
  const drawn = new Set<string>();
  for (const verse of verses) {
    for (const block of captionTranslations(verse, ids, wordByWord)) {
      if (block.source !== 'words') drawn.add(block.id);
    }
  }
  return ids.filter(id => drawn.has(id));
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
