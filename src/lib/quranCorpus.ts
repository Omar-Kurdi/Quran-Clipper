/**
 * Server-side Quran text access.
 *
 * Fetches whole chapters in one call (instead of one request per ayah) and
 * memoises them for the lifetime of the process, so alignment can fetch the
 * same passage repeatedly without hammering api.quran.com.
 */

import { VerseWord } from '@/lib/quranData';
import { quranApiJson, translationIdsToRequest, preferredTranslation } from './quranApi';
import { pairVerseWords } from './verseSpelling';
import { primaryTranslation } from './clearQuran';

type QuranApiWord = {
  char_type_name?: string;
  text_uthmani?: string;
  /** The mushaf page glyph for this word, and the page whose font draws it. */
  code_v2?: string;
  v2_page?: number;
  translation?: { text?: string };
};

type QuranApiVerse = {
  verse_number: number;
  verse_key: string;
  text_uthmani: string;
  translations?: { resource_id?: number; text?: string }[];
  words?: QuranApiWord[];
};

export type CorpusVerse = {
  surahNumber: number;
  verseNumber: number;
  verseKey: string;
  textUthmani: string;
  translation: string;
  words: VerseWord[];
};

export function cleanHtml(input = '') {
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

const CHAPTER_PATH = (surah: number) =>
  `/verses/by_chapter/${surah}` +
  `?language=en&words=true&translations=${translationIdsToRequest().join(',')}&fields=text_uthmani` +
  `&word_fields=text_uthmani,translation,code_v2,v2_page&per_page=300`;

/**
 * The words of one verse, spelled as the verse spells them.
 *
 * Everything on screen shows the verse-level text. The word list is still what
 * carries the translation and what every word index means, so the verse's own
 * words are paired onto it rather than replacing it; see `verseSpelling`. A
 * verse that cannot be paired keeps the list's spelling, which is wrong-looking
 * but never misaligned.
 */
export function verseWords(verse: {
  verse_key: string;
  text_uthmani: string;
  words?: QuranApiWord[];
}): VerseWord[] {
  const recited = (verse.words || []).filter(word => word.char_type_name === 'word');
  const spelling = pairVerseWords(recited.map(word => word.text_uthmani || ''), verse.text_uthmani);
  if (!spelling) {
    console.warn(`[quranCorpus] ${verse.verse_key}: verse text and word list do not pair; showing the word list.`);
  }
  return recited
    .map((word, index) => ({
      arabic: spelling?.[index] ?? word.text_uthmani ?? '',
      translation: cleanHtml(word.translation?.text || ''),
      excluded: false,
      ...(word.code_v2 && word.v2_page ? { glyph: word.code_v2, glyphPage: word.v2_page } : {})
    }))
    .filter(word => word.arabic);
}

const chapterCache = new Map<number, Promise<CorpusVerse[]>>();

async function loadChapter(surahNumber: number): Promise<CorpusVerse[]> {
  const { data } = await quranApiJson<{ verses?: QuranApiVerse[] }>(
    CHAPTER_PATH(surahNumber),
    { next: { revalidate: 86400 } },
    // Text with no translation is not an answer: the aligner writes that
    // translation onto every caption it produces.
    body => (body.verses || []).some(v => preferredTranslation(v.translations))
  );
  if (!data?.verses?.length) throw new Error(`Unable to fetch Quran chapter ${surahNumber}.`);

  return data.verses.map(verse => {
    const words = verseWords(verse);

    return {
      surahNumber,
      verseNumber: verse.verse_number,
      verseKey: verse.verse_key,
      textUthmani: verse.text_uthmani,
      // Through `primaryTranslation`, not `preferredTranslation`: this is the
      // path an AI match builds its captions from, and the upstream cannot
      // serve The Clear Quran.
      translation: primaryTranslation({
        surah: surahNumber,
        ayah: verse.verse_number,
        translations: verse.translations,
        wanted: translationIdsToRequest(),
        clean: cleanHtml
      }),
      words
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
