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
  /** Named translations on screen, for the credit. Empty is fine; the source is still credited. */
  translationNames?: string[];
  /** The captions themselves, when the text is to be included. */
  verses?: VerseData[];
  /** Whether the ayah text and its translation go in the description. */
  includeVerseText?: boolean;
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

const trimTo = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;

export function buildPublishMetadata(input: PublishInput): PublishMetadata {
  const reference = ayahReference(input.surahNumber, input.ayahStart, input.ayahEnd);
  const surah = input.surahNameEnglish.trim() || `Surah ${input.surahNumber}`;
  const reciter = input.reciterName.trim();
  let truncated = false;

  // --- title -------------------------------------------------------------
  // The reciter goes first when something has to give: the surah and the
  // reference are what the clip *is*, and a title that loses them is no longer
  // about this video. #Shorts is kept whatever happens -- it is the one part
  // that changes how the platform treats the upload rather than how it reads.
  const full = `Surah ${surah} ${reference}${reciter ? ` | ${reciter}` : ''} #Shorts`;
  let title = full;
  if (title.length > TITLE_MAX) {
    title = `Surah ${surah} ${reference} #Shorts`;
    truncated = true;
  }
  title = trimTo(title, TITLE_MAX);

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
  if (named.length) credits.push(`Translation: ${named.join(', ')}`);
  credits.push('Quran text and translations via quran.com.');

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
