import { NextRequest, NextResponse } from 'next/server';
import { cleanHtml, verseWords } from '@/lib/quranCorpus';
import { quranApiJson, translationIdsToRequest, preferredTranslation } from '@/lib/quranApi';
import { primaryTranslation } from '@/lib/localTranslations';
import { RECITERS, SURAHS_LIST } from '@/lib/quranData';
import { proxiedAudioUrl } from '@/app/api/audio/proxy/route';
import { qulSurah } from '@/lib/qulRecitations';
import { measuredSurah } from '@/lib/measuredRecitations';
import { estimatesFrom, loadBounds } from '@/lib/publishedTiming';
import { chooseReciterTiming, pairedRecording } from '@/lib/reciterTimingChoice';
import { fetchReciterTimings } from '@/lib/publishedTiming';
import { timingPair } from '@/lib/timingAudit';

function getReciterAudioUrl(reciterId: string, surahNumber: number) {
  const reciter = RECITERS.find(r => r.id === reciterId) || RECITERS[0];
  const paddedSurah = String(surahNumber).padStart(3, '0');
  return `${reciter.audioServerUrl}${paddedSurah}.mp3`;
}

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

    const reciterMeta = RECITERS.find(r => r.id === reciter) || RECITERS[0];
    // A QUL-only reciter has no recording to fall back to without its export.
    if (reciterMeta.needsQul && !qulSurah(reciterMeta.id, surahNumber)) {
      return NextResponse.json(
        { success: false, error: `${reciterMeta.name} needs QUL's timing export, which this studio has not imported.` },
        { status: 404 }
      );
    }

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
          `&fields=text_uthmani&word_fields=text_uthmani,translation,code_v2,v2_page,line_v2&per_page=300`,
        { next: { revalidate: 86400 } },
        // A chapter the configured upstream does not carry, or carries without
        // the translation, is not usable however cleanly it answered.
        body => (body.verses || []).some(v => preferredTranslation(v.translations, wantedTranslations))
      );

      if (quranData?.verses?.length) {
        const allVerses = quranData.verses;
        
        // Filter requested range
        const filtered = allVerses.filter(v => v.verse_number >= start && v.verse_number <= end);

        // quran.com first, so a reciter it covers loads as before; QUL's export,
        // where this machine has one, for a reciter quran.com has not timed.
        // Where the surah was audited, the pairing it found decides instead.
        const quranComTimings = await fetchReciterTimings(reciterMeta.quranApiId, surahNumber);
        const qulTimings = qulSurah(reciter, surahNumber);
        const pair = timingPair(reciterMeta.id, surahNumber);
        const choice = chooseReciterTiming(filtered.map(v => v.verse_key), quranComTimings, qulTimings, pair);
        // A recording whose published timings are wrong for it is timed from
        // this studio's own measurement instead -- see `measuredRecitations`.
        const measured = measuredSurah(reciterMeta.id, surahNumber);
        // A QUL-only reciter has no estimate to fall back on: its recording is
        // QUL's, and the timings the export has for this passage are broken.
        if (reciterMeta.needsQul && !choice.provider && !measured) {
          return NextResponse.json(
            { success: false, error: `QUL's timings for ${reciterMeta.name} are broken somewhere in this passage. Choose another reciter or range.` },
            { status: 422 }
          );
        }

        // The surah's one recording, even where this passage has no usable
        // timings on it: the aligner times it on that file. Where the source
        // that names it did not answer this throws, and the load fails below
        // rather than switching to another recording of the same surah.
        const recording = measured?.audioUrl ?? choice.audioUrl ??
          pairedRecording(quranComTimings, qulTimings, pair, Boolean(reciterMeta.quranApiId));

        const repaired = loadBounds(
          measured,
          choice,
          filtered.map(v => ({ verseKey: v.verse_key, wordCount: verseWords(v).length, words: verseWords(v).map(word => word.arabic) })),
          reciterMeta.id
        );

        let currentOffset = estimatesFrom(repaired, choice, filtered[0]);
        const mappedVerses = filtered.map(v => {
          const words = verseWords(v);

          const timing = repaired?.get(v.verse_key) ?? null;
          let verseStart: number;
          let verseEnd: number;
          if (timing) {
            // Kept absolute, on the recording's own clock: the timeline, the
            // playhead, the canvas and the exporter all read these against the
            // same <audio> element, so rebasing them to zero would desync
            // every one of them.
            verseStart = Math.round(timing.start * 10) / 10;
            verseEnd = Math.round(timing.end * 10) / 10;
            currentOffset = verseEnd;
          } else {
            const approxDuration = Math.max(3.5, Math.max(v.text_uthmani.length, words.length * 8) * 0.15);
            verseStart = Math.round(currentOffset * 10) / 10;
            verseEnd = Math.round((currentOffset + approxDuration) * 10) / 10;
            currentOffset += approxDuration + 0.8;
          }

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

        const totalSeconds = choice.totalSeconds || currentOffset;

        return NextResponse.json({
          success: true,
          source: 'quran_api',
          surahNumber,
          surahNameArabic: surahMeta.nameArabic,
          surahNameEnglish: surahMeta.nameEnglish,
          // Paired with the timings above -- see `fetchReciterTimings`.
          // Proxied either way. A reciter with no measured timings used to be
          // served straight from mp3quran.net, which publishes an AAAA record --
          // so on a machine with no IPv6 route that one reciter failed while the
          // timed ones worked.
          audioUrl: proxiedAudioUrl(recording ?? getReciterAudioUrl(reciter, surahNumber)),
          audioDuration: `${Math.floor(totalSeconds / 60)}:${Math.floor(totalSeconds % 60).toString().padStart(2, '0')}`,
          /** 'measured' means the boundaries came from the recording; 'estimated' means they were guessed from text length. */
          timingSource: choice.provider || measured ? 'measured' : 'estimated',
          /** Whose measurements: quran.com's, or QUL's for a reciter quran.com has not timed. */
          timingProvider: measured ? 'measured' : choice.provider,
          verses: mappedVerses
        });
      }
    } catch {
      // API fallback
    }

    // A reciter with published timings is played on the recording they were
    // measured on, which only its source can name -- so without it, no load.
    if (reciterMeta.quranApiId || qulSurah(reciterMeta.id, surahNumber)) {
      return NextResponse.json(
        { success: false, error: `Could not reach quran.com for ${reciterMeta.name}'s recording and timings. Try again in a moment.` },
        { status: 503 }
      );
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
      audioUrl: proxiedAudioUrl(getReciterAudioUrl(reciter, surahNumber)),
      audioDuration: `${Math.floor(approxTotal / 60)}:${Math.floor(approxTotal % 60).toString().padStart(2, '0')}`,
      timingSource: 'estimated',
      verses: fallbackVerses
    });

  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
