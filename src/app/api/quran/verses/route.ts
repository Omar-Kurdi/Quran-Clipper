import { NextRequest, NextResponse } from 'next/server';
import { cleanHtml, verseWords } from '@/lib/quranCorpus';
import { quranApiJson, translationIdsToRequest, preferredTranslation } from '@/lib/quranApi';
import { primaryTranslation } from '@/lib/localTranslations';
import { RECITERS, SURAHS_LIST } from '@/lib/quranData';
import { qfPassage, qfPassageUrl } from '@/lib/qfRecitations';

/** What the Quran API returns per ayah, as far as this route reads it. */
interface ApiVerse {
  verse_number: number;
  verse_key: string;
  text_uthmani: string;
  translations?: { resource_id?: number; text?: string }[];
  words?: {
    char_type_name?: string;
    text_uthmani?: string;
    code_v2?: string;
    v2_page?: number;
    line_v2?: number;
    translation?: { text?: string };
  }[];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const surahNumber = parseInt(searchParams.get('surah') || '1', 10);
    const start = parseInt(searchParams.get('start') || '1', 10);
    const end = parseInt(searchParams.get('end') || '7', 10);
    const surahMeta = SURAHS_LIST.find(s => s.number === surahNumber) || SURAHS_LIST[0];
    const reciterMeta = RECITERS.find(r => r.id === searchParams.get('reciter')) || RECITERS[0];

    // Query Quran.com API v4
    try {
      // Both the configured translation and the one that exists everywhere, so
      // a chapter the configured upstream does not hold still arrives with a
      // translation rather than with none.
      const wantedTranslations = translationIdsToRequest();

      /** Shared with `quranCorpus`, so the two caption paths cannot drift. */
      const translationFor = (verse: ApiVerse): string =>
        primaryTranslation({
          surah: surahNumber,
          ayah: verse.verse_number,
          translations: verse.translations,
          wanted: wantedTranslations,
          clean: cleanHtml
        });
      const { data: quranData } = await quranApiJson<{ verses?: ApiVerse[] }>(
        `/verses/by_chapter/${surahNumber}?language=en&words=true&translations=${wantedTranslations.join(',')}` +
          `&fields=text_uthmani&word_fields=text_uthmani,text_indopak,translation,code_v2,v2_page,line_v2&per_page=300`,
        { next: { revalidate: 86400 } },
        // A chapter the configured upstream does not carry, or carries without
        // the translation, is not usable however cleanly it answered.
        body => (body.verses || []).some(v => preferredTranslation(v.translations, wantedTranslations))
      );

      if (quranData?.verses?.length) {
        const allVerses = quranData.verses;
        
        // Filter requested range
        const filtered = allVerses.filter(v => v.verse_number >= start && v.verse_number <= end);

        const first = filtered[0]?.verse_number ?? start;
        const last = filtered[filtered.length - 1]?.verse_number ?? end;
        // The ayahs' own files laid end to end: each ayah starts where its
        // file does, so these bounds are the recording's, not a measurement.
        const passage = await qfPassage(reciterMeta.id, surahNumber, first, last).catch(() => null);
        if (!passage) {
          return NextResponse.json(
            { success: false, error: `Could not get ${reciterMeta.name}'s recitation of this passage. Try again in a moment.` },
            { status: 503 }
          );
        }
        const bounds = new Map(passage.ayahs.map(ayah => [ayah.verseKey, ayah]));

        const mappedVerses = filtered.map(v => {
          const words = verseWords(v);
          const timing = bounds.get(v.verse_key);
          const verseStart = Math.round((timing?.start ?? 0) * 1000) / 1000;
          const verseEnd = Math.round((timing?.end ?? 0) * 1000) / 1000;

          const cleanTranslation = translationFor(v);

          return {
            verseNumber: v.verse_number,
            verseKey: v.verse_key,
            textUthmani: v.text_uthmani,
            translation: cleanTranslation,
            startTime: verseStart,
            endTime: verseEnd,
            words
          };
        });

        const totalSeconds = passage.totalSeconds;

        return NextResponse.json({
          success: true,
          source: 'quran_api',
          surahNumber,
          surahNameArabic: surahMeta.nameArabic,
          surahNameEnglish: surahMeta.nameEnglish,
          audioUrl: qfPassageUrl(reciterMeta.id, surahNumber, first, last),
          audioDuration: `${Math.floor(totalSeconds / 60)}:${Math.floor(totalSeconds % 60).toString().padStart(2, '0')}`,
          /** The ayah bounds are the ayah files' own. */
          timingSource: 'measured',
          timingProvider: 'qf',
          verses: mappedVerses
        });
      }
    } catch {
      // API fallback
    }

    return NextResponse.json(
      { success: false, error: `Could not reach the Quran text for ${surahMeta.nameEnglish}. Try again in a moment.` },
      { status: 503 }
    );

  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
