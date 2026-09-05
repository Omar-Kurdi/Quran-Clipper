import { NextRequest, NextResponse } from 'next/server';
import { TRANSLATION_ID, cleanHtml } from '@/lib/quranCorpus';
import { quranApiFetch } from '@/lib/quranApi';
import { RECITERS, SAMPLE_PROJECTS, SURAHS_LIST } from '@/lib/quranData';
import { proxiedAudioUrl } from '@/app/api/audio/proxy/route';

function getReciterAudioUrl(reciterId: string, surahNumber: number) {
  const reciter = RECITERS.find(r => r.id === reciterId) || RECITERS[0];
  const paddedSurah = String(surahNumber).padStart(3, '0');
  return `${reciter.audioServerUrl}${paddedSurah}.mp3`;
}

/**
 * Measured per-ayah timings for a reciter's chapter recording.
 *
 * The studio used to invent these: every ayah got `max(3.5, length * 0.15)`
 * seconds laid end to end from zero. For a range starting past ayah 1 that is
 * not an approximation, it is wrong -- ayah 5's block sat at 0:00 while the
 * recording at 0:00 is ayah 1 -- and even from ayah 1 it drifted apart within
 * a few ayahs. quran.com publishes the real boundaries, so use them.
 *
 * The timings index quran.com's own recording, so `audioUrl` here must travel
 * with them; pairing them with the mp3quran file would be just as wrong as the
 * estimates were. Returns null whenever anything is missing, and the caller
 * falls back to estimates against mp3quran.
 */
type VerseTiming = { start: number; end: number };

async function fetchReciterTimings(
  quranApiId: number,
  surahNumber: number
): Promise<{ audioUrl: string; totalSeconds: number; timings: Map<string, VerseTiming> } | null> {
  if (!quranApiId) return null;
  try {
    const res = await fetch(
      `https://api.qurancdn.com/api/qdc/audio/reciters/${quranApiId}/audio_files?chapter=${surahNumber}&segments=true`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const file = data?.audio_files?.[0];
    if (!file?.audio_url || !Array.isArray(file.verse_timings)) return null;

    const timings = new Map<string, VerseTiming>();
    for (const entry of file.verse_timings as { verse_key?: string; timestamp_from?: number; timestamp_to?: number }[]) {
      if (!entry?.verse_key) continue;
      // Milliseconds. The response also carries its own `duration` field, which
      // comes back negative -- computing it from the two timestamps instead.
      const start = (entry.timestamp_from ?? 0) / 1000;
      const end = (entry.timestamp_to ?? 0) / 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      timings.set(entry.verse_key, { start, end });
    }
    if (timings.size === 0) return null;

    return {
      audioUrl: file.audio_url as string,
      totalSeconds: Number.isFinite(file.duration) ? file.duration / 1000 : 0,
      timings
    };
  } catch {
    return null;
  }
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

    // Hand-authored sample, used as a shortcut for the ranges it covers -- but
    // only for reciters quran.com has no timings for. Every sample here is
    // Sudais, who does have them, so taking this shortcut would hand back
    // estimated boundaries for exactly the surah/reciter/range the studio opens
    // on: the first Load a new user clicks would be the one that is not timed.
    const sample = SAMPLE_PROJECTS.find(
      s => s.surahNumber === surahNumber && s.reciterId === reciter
    );

    if (sample && start === sample.ayahStart && end === sample.ayahEnd && !reciterMeta.quranApiId) {
      return NextResponse.json({
        success: true,
        source: 'cached_sample',
        surahNumber,
        surahNameArabic: sample.surahNameArabic,
        surahNameEnglish: sample.surahNameEnglish,
        audioUrl: sample.audioUrl,
        audioDuration: sample.audioDuration,
        timingSource: 'estimated',
        verses: sample.verses
      });
    }

    // Otherwise query Quran.com API v4
    try {
      const { res: quranRes } = await quranApiFetch(
        `/verses/by_chapter/${surahNumber}?language=en&words=true&translations=${TRANSLATION_ID}` +
          `&fields=text_uthmani&word_fields=text_uthmani,translation&per_page=300`,
        { next: { revalidate: 86400 } }
      );

      if (quranRes?.ok) {
        const quranData = await quranRes.json();
        const allVerses = quranData.verses || [];
        
        // Filter requested range
        const filtered = allVerses.filter((v: { verse_number: number }) => 
          v.verse_number >= start && v.verse_number <= end
        );

        const measured = await fetchReciterTimings(reciterMeta.quranApiId, surahNumber);
        // All measured or none of them. A half-timed range would mix absolute
        // timestamps with offsets counted from zero, which is worse than either.
        const useMeasured =
          !!measured && filtered.every((v: { verse_key: string }) => measured.timings.has(v.verse_key));

        let currentOffset = 0;
        const mappedVerses = filtered.map((v: { verse_number: number; verse_key: string; text_uthmani: string; translations: { text: string }[]; words?: { char_type_name?: string; text_uthmani?: string; translation?: { text?: string } }[] }) => {
          const quranWords = (v.words || []).filter(w => w.char_type_name === 'word');
          const words = quranWords.map(w => ({
            arabic: w.text_uthmani || '',
            translation: cleanHtml(w.translation?.text || ''),
            excluded: false
          })).filter(w => w.arabic);

          const timing = useMeasured ? measured!.timings.get(v.verse_key)! : null;
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

          const rawTranslation = v.translations?.[0]?.text || '';
          const cleanTranslation = cleanHtml(rawTranslation);

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

        const totalSeconds = useMeasured ? measured!.totalSeconds || currentOffset : currentOffset;

        return NextResponse.json({
          success: true,
          source: 'quran_api',
          surahNumber,
          surahNameArabic: surahMeta.nameArabic,
          surahNameEnglish: surahMeta.nameEnglish,
          // Paired with the timings above -- see `fetchReciterTimings`.
          audioUrl: useMeasured ? proxiedAudioUrl(measured!.audioUrl) : getReciterAudioUrl(reciter, surahNumber),
          audioDuration: `${Math.floor(totalSeconds / 60)}:${Math.floor(totalSeconds % 60).toString().padStart(2, '0')}`,
          /** 'measured' means the boundaries came from the recording; 'estimated' means they were guessed from text length. */
          timingSource: useMeasured ? 'measured' : 'estimated',
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
      timingSource: 'estimated',
      verses: fallbackVerses
    });

  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
