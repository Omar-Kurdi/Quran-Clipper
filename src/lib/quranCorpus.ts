/**
 * Server-side Quran text access.
 *
 * Fetches whole chapters in one call (instead of one request per ayah) and
 * memoises them for the lifetime of the process, so alignment can freely scan
 * a wide candidate pool of ayahs without hammering api.quran.com.
 */

import { SURAHS_LIST, VerseData, VerseWord } from '@/lib/quranData';
import { normalizeArabic } from '@/lib/arabic';

type QuranApiWord = {
  char_type_name?: string;
  text_uthmani?: string;
  transliteration?: { text?: string };
  translation?: { text?: string };
};

type QuranApiVerse = {
  verse_number: number;
  verse_key: string;
  text_uthmani: string;
  translations?: { text: string }[];
  words?: QuranApiWord[];
};

export type CorpusVerse = {
  surahNumber: number;
  verseNumber: number;
  verseKey: string;
  textUthmani: string;
  transliteration: string;
  translation: string;
  words: VerseWord[];
  /** Normalised tokens, index-aligned with `words`. */
  tokens: string[];
};

function cleanHtml(input = '') {
  return input
    // Footnote markers ship as <sup foot_note="...">1</sup>. Stripping only the
    // tags would leave the bare digit glued to the preceding word ("Allāh,1"),
    // which reads as a typo once it's burned into a video frame.
    // `[\s\S]` rather than the `s` flag: the project's TS target predates es2018.
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .replace(/&quot;/g, '"')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Ayah-level English translation resource id on api.quran.com.
 *
 * This previously pointed at 131, which no longer exists in the API: requests
 * still returned HTTP 200 but silently omitted the `translations` field
 * entirely, so every ayah came back with an empty translation. Verify any new
 * id against `/api/v4/resources/translations?language=en` before setting it --
 * an invalid id fails quietly rather than erroring.
 */
const TRANSLATION_ID = process.env.QURAN_TRANSLATION_ID || '20'; // Saheeh International

const CHAPTER_URL = (surah: number) =>
  `https://api.quran.com/api/v4/verses/by_chapter/${surah}` +
  `?language=en&words=true&translations=${TRANSLATION_ID}&fields=text_uthmani` +
  `&word_fields=text_uthmani,transliteration,translation&per_page=300`;

const chapterCache = new Map<number, Promise<CorpusVerse[]>>();

async function loadChapter(surahNumber: number): Promise<CorpusVerse[]> {
  const res = await fetch(CHAPTER_URL(surahNumber), {
    headers: { Accept: 'application/json' },
    next: { revalidate: 86400 }
  });
  if (!res.ok) throw new Error(`Unable to fetch Quran chapter ${surahNumber} (${res.status}).`);

  const data = (await res.json()) as { verses?: QuranApiVerse[] };
  return (data.verses || []).map(verse => {
    const words: VerseWord[] = (verse.words || [])
      .filter(word => word.char_type_name === 'word')
      .map(word => ({
        arabic: word.text_uthmani || '',
        transliteration: cleanHtml(word.transliteration?.text || ''),
        translation: cleanHtml(word.translation?.text || ''),
        excluded: false
      }))
      .filter(word => word.arabic);

    return {
      surahNumber,
      verseNumber: verse.verse_number,
      verseKey: verse.verse_key,
      textUthmani: verse.text_uthmani,
      transliteration: words.map(w => w.transliteration).filter(Boolean).join(' ') || `Verse ${verse.verse_key}`,
      translation: cleanHtml(verse.translations?.[0]?.text || ''),
      words,
      tokens: words.map(word => normalizeArabic(word.arabic))
    };
  });
}

export function getChapter(surahNumber: number): Promise<CorpusVerse[]> {
  const cached = chapterCache.get(surahNumber);
  if (cached) return cached;

  const pending = loadChapter(surahNumber).catch(err => {
    chapterCache.delete(surahNumber);
    throw err;
  });
  chapterCache.set(surahNumber, pending);
  return pending;
}

export async function getVerse(surahNumber: number, verseNumber: number): Promise<CorpusVerse | null> {
  const chapter = await getChapter(surahNumber);
  return chapter.find(verse => verse.verseNumber === verseNumber) || null;
}

export async function getVerseByKey(verseKey: string): Promise<CorpusVerse | null> {
  const [surah, ayah] = verseKey.split(':').map(Number);
  if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return null;
  return getVerse(surah, ayah);
}

export async function getRange(surahNumber: number, start: number, end: number): Promise<CorpusVerse[]> {
  const chapter = await getChapter(surahNumber);
  return chapter.filter(verse => verse.verseNumber >= start && verse.verseNumber <= end);
}

/**
 * Ayahs the aligner is allowed to match against, scoped to one surah +/- a
 * padding window (plus Al-Fatihah and the next surah).
 *
 * Not currently called anywhere -- `asrAligner.ts` searches the full Quran
 * via `buildFullQuranPool()` instead, since the surah/ayah are discovered
 * from the audio rather than assumed from the UI's selection. Kept as a
 * correct, ready-to-use fast path for if a "I already know the surah, skip
 * the full search" mode is ever wanted.
 */
export async function buildCandidatePool(params: {
  surahNumber: number;
  start: number;
  end: number;
  padding?: number;
}): Promise<CorpusVerse[]> {
  const padding = params.padding ?? 15;
  const meta = SURAHS_LIST.find(s => s.number === params.surahNumber) || SURAHS_LIST[0];

  const chapters = new Set<number>([params.surahNumber, 1]);
  // A recitation that runs past the end of a surah continues into the next.
  if (params.surahNumber < 114) chapters.add(params.surahNumber + 1);

  const loaded = await Promise.all(
    Array.from(chapters).map(async surah => {
      try {
        return await getChapter(surah);
      } catch {
        return [] as CorpusVerse[];
      }
    })
  );

  const pool: CorpusVerse[] = [];
  const seen = new Set<string>();

  const push = (verse: CorpusVerse) => {
    if (seen.has(verse.verseKey)) return;
    seen.add(verse.verseKey);
    pool.push(verse);
  };

  const primary = loaded.find(chapter => chapter[0]?.surahNumber === params.surahNumber) || [];
  const windowStart = Math.max(1, params.start - padding);
  const windowEnd = Math.min(meta.numberOfAyahs, params.end + padding);

  primary.filter(v => v.verseNumber >= windowStart && v.verseNumber <= windowEnd).forEach(push);
  primary.slice(0, 5).forEach(push);
  loaded.flat().forEach(push);

  return pool;
}

const ALL_SURAH_NUMBERS = Array.from({ length: 114 }, (_, i) => i + 1);

/**
 * The entire Quran as a flat candidate pool, for when the reciter's surah
 * isn't known ahead of time and has to be discovered from the audio itself.
 * Chapters are fetched with limited concurrency and reuse the same
 * per-chapter cache as everything else, so repeat calls within the same
 * server process (i.e. every request after the first) are effectively free.
 */
export async function buildFullQuranPool(concurrency = 8): Promise<CorpusVerse[]> {
  const pool: CorpusVerse[] = [];
  for (let i = 0; i < ALL_SURAH_NUMBERS.length; i += concurrency) {
    const batch = ALL_SURAH_NUMBERS.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(surah => getChapter(surah).catch(() => [] as CorpusVerse[])));
    for (const chapter of batchResults) pool.push(...chapter);
  }
  return pool;
}
