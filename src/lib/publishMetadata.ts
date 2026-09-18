/**
 * The caption that goes up with the clip.
 *
 * Everything a post needs is already known here -- which surah, which ayahs,
 * who recited them, which translation is on screen -- and it was being retyped
 * by hand into YouTube every time, which is how a description ends up saying
 * 1:1-7 for a clip that was trimmed to 1:3-7.
 *
 * Pure and shaped for YouTube Shorts, which is what this studio's default
 * frame is for. The other platforms take the same text; only the limits differ,
 * and YouTube's are the tightest of the ones that matter here.
 *
 * On the Quran text itself: including an ayah and its translation in a
 * description is publication, not storage, so the 7-day caching rule the
 * Foundation terms impose is not what governs it -- attribution is. Whenever
 * the text is included, the credit lines come with it and are not optional.
 */

import { WORD_BY_WORD_PROVIDER } from '@/lib/translations';
import { VerseData } from './quranData';

/** YouTube's limits, which are the ones this has to fit. */
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;
/** Across the whole list, commas included. */
export const TAGS_MAX = 500;

export interface PublishInput {
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  /** The range **on the timeline**, which a trim may have narrowed. */
  ayahStart: number;
  ayahEnd: number;
  reciterName: string;
  /**
   * Named translations actually drawn on the card, for the credit.
   *
   * Drawn, not chosen. With the word mask on, a chosen translation may not be
   * on screen at all -- the glosses replace it, and identical gloss lines
   * collapse to one -- and crediting a translator for text the video does not
   * contain is a false attribution in the other direction. The caller filters
   * to what is drawn; this credits what it is handed.
   *
   * Empty is fine; the source is still credited.
   */
  translationNames?: string[];
  /** The captions themselves, when the text is to be included. */
  verses?: VerseData[];
  /** Whether the ayah text and its translation go in the description. */
  includeVerseText?: boolean;
  /**
   * Set when the card's English is built from word-by-word glosses.
   *
   * It changes who is being credited. Those glosses are quran.com's own
   * word-by-word dataset, not the translation named in the picker -- so
   * crediting the chosen translator over them would put their name to words
   * they did not write.
   */
  wordByWord?: boolean;
}

export interface PublishMetadata {
  title: string;
  description: string;
  /** In the order they appear at the end of the description. */
  hashtags: string[];
  /** YouTube's keyword list, comma-separated when copied. */
  tags: string[];
  /** True when something had to be cut to fit a limit, so the UI can say so. */
  truncated: boolean;
}

/** `1:1-7`, or `1:5` when a clip is one ayah. */
export function ayahReference(surah: number, start: number, end: number): string {
  return end > start ? `${surah}:${start}-${end}` : `${surah}:${start}`;
}

/**
 * A hashtag from a surah name.
 *
 * `Al-Fatihah` becomes `#AlFatihah`: hashtags break on punctuation, so a
 * hyphen would end the tag halfway and leave `Fatihah` as loose text.
 */
export function hashtagFor(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
  return cleaned ? `#${cleaned}` : '';
}

/**
 * Hashtags that may ride along with `#Shorts` in the title.
 *
 * A list rather than two words spelled into the title, so the cap below means
 * something: add a third and a title still carries two, chosen per clip
 * instead of always the same two.
 */
export const TITLE_HASHTAGS = ['#Quran', '#BeautifulRecitation'];

/** How many of `TITLE_HASHTAGS` one title may carry, on top of `#Shorts`. */
export const TITLE_HASHTAG_MAX = 2;

/**
 * `TITLE_HASHTAGS` shuffled for one clip, capped at `TITLE_HASHTAG_MAX`.
 *
 * Deterministic on the clip rather than on the call, which is the whole point
 * of doing it here. `buildPublishMetadata` is pure and the caption panel
 * re-renders freely, so `Math.random()` would rewrite the title while someone
 * was reading it -- and reshuffle it between the copy button and the paste.
 * Seeding on what identifies the clip gives what is actually wanted, which is
 * that consecutive uploads do not all carry the same tag in the same place,
 * while any one clip's title stays put.
 *
 * FNV-1a and an LCG, spelled out here rather than shared: this needs a stable
 * spread over a handful of strings, not a hash, and the only other digest in
 * the codebase belongs to ground-truth file naming.
 */
export function titleHashtags(seed: string): string[] {
  const pool = [...TITLE_HASHTAGS];
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  for (let i = pool.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, TITLE_HASHTAG_MAX);
}

const trimTo = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;

/**
 * The title, and whether anything had to be dropped to fit `TITLE_MAX`.
 *
 * Assembled longest-first and cut from the most decorative end: the pool
 * hashtags are decoration, the reciter is a credit, and the surah with its
 * reference is what the clip *is* -- a title that loses those is no longer
 * about this video. `#Shorts` survives every candidate; it is the one part
 * that changes how the platform treats the upload rather than how it reads.
 */
export function buildTitle(surah: string, reference: string, reciter: string): {
  title: string;
  truncated: boolean;
} {
  const extras = titleHashtags(`${reference}|${reciter}`);
  const subject = `Surah ${surah} ${reference}`;
  const withReciter = `${subject}${reciter ? ` | ${reciter}` : ''}`;

  const candidates: string[] = [];
  for (let keep = extras.length; keep >= 0; keep--) {
    candidates.push(`${withReciter} #Shorts ${extras.slice(0, keep).join(' ')}`.trimEnd());
  }
  candidates.push(`${subject} #Shorts`);

  const fits = candidates.find(candidate => candidate.length <= TITLE_MAX);
  const chosen = fits ?? candidates[candidates.length - 1];
  return { title: trimTo(chosen, TITLE_MAX), truncated: chosen !== candidates[0] };
}

export function buildPublishMetadata(input: PublishInput): PublishMetadata {
  const reference = ayahReference(input.surahNumber, input.ayahStart, input.ayahEnd);
  const surah = input.surahNameEnglish.trim() || `Surah ${input.surahNumber}`;
  const reciter = input.reciterName.trim();
  let truncated = false;

  // --- title -------------------------------------------------------------
  const titled = buildTitle(surah, reference, reciter);
  const title = titled.title;
  if (titled.truncated) truncated = true;

  // --- hashtags and tags -------------------------------------------------
  const surahTag = hashtagFor(surah);
  // Both forms of the surah's own tag. `#AlAnkabut` is what someone types when
  // they already know the name; `#SurahAlAnkabut` is what the rest search, and
  // it is the one that reads as a title rather than as a word. Neither is a
  // substitute for the other, and a hashtag costs nothing.
  const surahTitleTag = hashtagFor(`Surah ${surah}`);
  const hashtags = ['#Quran', '#QuranRecitation', surahTag, '#Islam', '#Shorts', surahTitleTag]
    .filter(Boolean)
    // A one-word surah name makes the two the same tag; repeating it would
    // read as a mistake.
    .filter((tag, index, all) => all.indexOf(tag) === index);

  const tagCandidates = [
    'quran',
    'quran recitation',
    'holy quran',
    `surah ${surah.toLowerCase()}`,
    surah.toLowerCase(),
    reference,
    reciter.toLowerCase(),
    'islam',
    'islamic',
    'shorts'
  ].filter(Boolean);

  // Kept whole rather than cut mid-word: YouTube counts the joined string, and
  // half a keyword is not a keyword.
  const tags: string[] = [];
  let tagLength = 0;
  for (const tag of tagCandidates) {
    const cost = tag.length + (tags.length ? 2 : 0);
    if (tagLength + cost > TAGS_MAX) { truncated = true; continue; }
    tags.push(tag);
    tagLength += cost;
  }

  // --- description -------------------------------------------------------
  const credits: string[] = [];
  const named = (input.translationNames ?? []).filter(name => name.trim());
  // The gloss line is credited to the dataset it comes from. `named` already
  // holds only the translations still on screen beside it -- hand-corrected
  // slots, in practice -- so nothing is dropped and nothing is invented.
  const credited = input.wordByWord
    ? [`Word-by-word glosses (${WORD_BY_WORD_PROVIDER})`, ...named]
    : named;
  if (credited.length) credits.push(`Translation: ${credited.join(', ')}`);
  // The Arabic comes from quran.com; a translation may not -- an installation
  // can hold an edition locally -- so the translator is credited on its own
  // line above rather than folded into a source that is only half right.
  credits.push('Quran text via quran.com.');

  const head = [
    `${surah} (${input.surahNameArabic}) · Ayah ${input.ayahEnd > input.ayahStart ? `${input.ayahStart}-${input.ayahEnd}` : input.ayahStart}`,
    reciter ? `Recited by ${reciter}` : ''
  ].filter(Boolean).join('\n');

  const tail = `${credits.join('\n')}\n\n${hashtags.join(' ')}`;

  let body = '';
  if (input.includeVerseText && input.verses?.length) {
    // One block per ayah, deduplicated by verse key: a repeated phrase is two
    // captions of the same ayah, and printing it twice would read as an error.
    const seen = new Set<string>();
    const blocks: string[] = [];
    for (const verse of input.verses) {
      if (seen.has(verse.verseKey)) continue;
      seen.add(verse.verseKey);
      const arabic = (verse.textUthmani || '').trim();
      const translation = (verse.translation || '').trim();
      if (!arabic && !translation) continue;
      blocks.push([verse.verseKey, arabic, translation].filter(Boolean).join('\n'));
    }
    body = blocks.join('\n\n');
  }

  // Assembled longest-first so the credits and hashtags survive a passage that
  // does not fit: they are the part with an obligation attached.
  const room = DESCRIPTION_MAX - head.length - tail.length - 4;
  if (body && body.length > room) {
    body = trimTo(body, Math.max(0, room));
    truncated = true;
  }

  const description = trimTo(
    [head, body, tail].filter(Boolean).join('\n\n'),
    DESCRIPTION_MAX
  );

  return { title, description, hashtags, tags, truncated };
}

/**
 * The caption as a file, for saving next to the video.
 *
 * The same three fields the caption panel shows, in the order an upload form
 * asks for them, with rules between so a title is never mistaken for the first
 * line of a description when this is read back weeks later. Plain text rather
 * than JSON: the only thing that ever opens it is a person with an upload form
 * in the other window.
 */
export function captionFileText(meta: PublishMetadata): string {
  return [meta.title, '---', meta.description, '---', `TAGS\n${meta.tags.join(', ')}`].join('\n\n');
}
