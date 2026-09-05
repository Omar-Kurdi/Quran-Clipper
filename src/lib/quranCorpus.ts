/**
 * Server-side Quran text access.
 *
 * Fetches whole chapters in one call (instead of one request per ayah) and
 * memoises them for the lifetime of the process, so alignment can fetch the
 * same passage repeatedly without hammering api.quran.com.
 */

import { VerseData, VerseWord } from '@/lib/quranData';
import { normalizeArabic } from '@/lib/arabic';

type QuranApiWord = {
  char_type_name?: string;
  text_uthmani?: string;
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
 *
 * Exported because `/api/quran/verses` fetches the same resource for the Load
 * path. It kept its own copy of the number, which is how it was still asking
 * for 131 long after this one moved: loading a reciter gave every ayah an
 * empty translation, and only running the aligner -- which comes through here
 * -- filled them in.
 */
export const TRANSLATION_ID = process.env.QURAN_TRANSLATION_ID || '20'; // Saheeh International

const CHAPTER_URL = (surah: number) =>
  `https://api.quran.com/api/v4/verses/by_chapter/${surah}` +
  `?language=en&words=true&translations=${TRANSLATION_ID}&fields=text_uthmani` +
  `&word_fields=text_uthmani,translation&per_page=300`;

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
        translation: cleanHtml(word.translation?.text || ''),
        excluded: false
      }))
      .filter(word => word.arabic);

    return {
      surahNumber,
      verseNumber: verse.verse_number,
      verseKey: verse.verse_key,
      textUthmani: verse.text_uthmani,
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
