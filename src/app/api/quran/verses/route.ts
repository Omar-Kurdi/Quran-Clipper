import { NextRequest, NextResponse } from 'next/server';
import { RECITERS, SAMPLE_PROJECTS, SURAHS_LIST } from '@/lib/quranData';

function cleanHtml(input = '') {
  return input.replace(/<[^>]*>?/gm, '').replace(/&quot;/g, '"').trim();
}

function getReciterAudioUrl(reciterId: string, surahNumber: number) {
  const reciter = RECITERS.find(r => r.id === reciterId) || RECITERS[0];
  const paddedSurah = String(surahNumber).padStart(3, '0');
  return `${reciter.audioServerUrl}${paddedSurah}.mp3`;
}

function buildRangeFallbackVerses(surahNumber: number, start: number, end: number) {
  let currentOffset = 0;
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, idx) => {
    const verseNumber = start + idx;
    const approxDuration = 5;
    const verseStart = Math.round(currentOffset * 10) / 10;
    const verseEnd = Math.round((currentOffset + approxDuration) * 10) / 10;
    currentOffset += approxDuration + 0.6;
    return {
      verseNumber,
      verseKey: `${surahNumber}:${verseNumber}`,
      textUthmani: `سورة ${surahNumber} آية ${verseNumber}`,
      transliteration: `Surah ${surahNumber}, Ayah ${verseNumber}`,
      translation: 'Verse text could not be fetched. Please check your network connection, then reload ayah data.',
      startTime: verseStart,
      endTime: verseEnd,
      words: []
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const surahNumber = parseInt(searchParams.get('surah') || '1', 10);
    const start = parseInt(searchParams.get('start') || '1', 10);
    const end = parseInt(searchParams.get('end') || '7', 10);
    const reciter = searchParams.get('reciter') || RECITERS[0]?.id || 'sudais';
    const surahMeta = SURAHS_LIST.find(s => s.number === surahNumber) || SURAHS_LIST[0];

    // Check if we have sample project for instant match
    const sample = SAMPLE_PROJECTS.find(
      s => s.surahNumber === surahNumber && s.reciterId === reciter
    );

    if (sample && start === sample.ayahStart && end === sample.ayahEnd) {
      return NextResponse.json({
        success: true,
        source: 'cached_sample',
        surahNumber,
        surahNameArabic: sample.surahNameArabic,
        surahNameEnglish: sample.surahNameEnglish,
        audioUrl: sample.audioUrl,
        audioDuration: sample.audioDuration,
        verses: sample.verses
      });
    }

    // Otherwise query Quran.com API v4
    try {
      const quranRes = await fetch(
        `https://api.quran.com/api/v4/verses/by_chapter/${surahNumber}?language=en&words=true&translations=131&fields=text_uthmani&word_fields=text_uthmani,transliteration,translation&per_page=300`,
        { headers: { 'Accept': 'application/json' }, next: { revalidate: 86400 } }
      );

      if (quranRes.ok) {
        const quranData = await quranRes.json();
        const allVerses = quranData.verses || [];
        
        // Filter requested range
        const filtered = allVerses.filter((v: { verse_number: number }) => 
          v.verse_number >= start && v.verse_number <= end
        );

        let currentOffset = 0;
        const mappedVerses = filtered.map((v: { verse_number: number; verse_key: string; text_uthmani: string; translations: { text: string }[]; words?: { char_type_name?: string; text_uthmani?: string; transliteration?: { text?: string }; translation?: { text?: string } }[] }) => {
          const quranWords = (v.words || []).filter(w => w.char_type_name === 'word');
          const words = quranWords.map(w => ({
            arabic: w.text_uthmani || '',
            transliteration: cleanHtml(w.transliteration?.text || ''),
            translation: cleanHtml(w.translation?.text || ''),
            excluded: false
          })).filter(w => w.arabic);

          const approxDuration = Math.max(3.5, Math.max(v.text_uthmani.length, words.length * 8) * 0.15);
          const verseStart = Math.round(currentOffset * 10) / 10;
          const verseEnd = Math.round((currentOffset + approxDuration) * 10) / 10;
          currentOffset += approxDuration + 0.8;

          const rawTranslation = v.translations?.[0]?.text || '';
          const cleanTranslation = cleanHtml(rawTranslation);
          const transliteration = words.map(w => w.transliteration).filter(Boolean).join(' ') || `Verse ${v.verse_key}`;

          return {
            verseNumber: v.verse_number,
            verseKey: v.verse_key,
            textUthmani: v.text_uthmani,
            transliteration,
            translation: cleanTranslation,
            startTime: verseStart,
            endTime: verseEnd,
            words
          };
        });

        return NextResponse.json({
          success: true,
          source: 'quran_api',
          surahNumber,
          surahNameArabic: surahMeta.nameArabic,
          surahNameEnglish: surahMeta.nameEnglish,
          audioUrl: getReciterAudioUrl(reciter, surahNumber),
          audioDuration: `${Math.floor(currentOffset / 60)}:${Math.floor(currentOffset % 60).toString().padStart(2, '0')}`,
          verses: mappedVerses
        });
      }
    } catch {
      // API fallback
    }

    // Network/API fallback: keep the user's requested surah/range and reciter instead of silently switching to Al-Fatihah.
    const fallbackVerses = buildRangeFallbackVerses(surahNumber, start, end);
    const approxTotal = fallbackVerses[fallbackVerses.length - 1]?.endTime || 0;
    return NextResponse.json({
      success: true,
      source: 'range_fallback',
      surahNumber,
      surahNameArabic: surahMeta.nameArabic,
      surahNameEnglish: surahMeta.nameEnglish,
      audioUrl: getReciterAudioUrl(reciter, surahNumber),
      audioDuration: `${Math.floor(approxTotal / 60)}:${Math.floor(approxTotal % 60).toString().padStart(2, '0')}`,
      verses: fallbackVerses
    });

  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
