import { RECITERS } from './quranData';
import { getRange } from './quranCorpus';
import { qulSurah } from './qulRecitations';
import { chooseReciterTiming, type QuranComTimings, type TimingChoice } from './reciterTimingChoice';

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
 *
 * The word segments are kept alongside the bounds, for splitting an ayah into
 * phrases after the load; see `publishedPhrases`.
 */
export async function fetchReciterTimings(quranApiId: number, surahNumber: number): Promise<QuranComTimings | null> {
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

    const timings: QuranComTimings['timings'] = new Map();
    for (const entry of file.verse_timings as { verse_key?: string; timestamp_from?: number; timestamp_to?: number; segments?: unknown }[]) {
      if (!entry?.verse_key) continue;
      // Milliseconds. The response also carries its own `duration` field, which
      // comes back negative -- computing it from the two timestamps instead.
      const start = (entry.timestamp_from ?? 0) / 1000;
      const end = (entry.timestamp_to ?? 0) / 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const segments = Array.isArray(entry.segments)
        ? entry.segments.filter((segment): segment is number[] => Array.isArray(segment) && segment.length >= 3)
        : undefined;
      timings.set(entry.verse_key, { start, end, segments });
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

/** A built-in reciter's published timings for these ayahs, from whichever source covers them all. */
export async function reciterTiming(reciterId: string, surah: number, verseKeys: string[]): Promise<TimingChoice> {
  const reciter = RECITERS.find(r => r.id === reciterId);
  return chooseReciterTiming(
    verseKeys,
    reciter ? await fetchReciterTimings(reciter.quranApiId, surah) : null,
    reciter ? qulSurah(reciter.id, surah) : null
  );
}

/**
 * A passage's published timings, when `audioUrl` is the recording they were
 * measured on -- the studio's proxy address for it, from any origin, or the
 * address itself. Null for any other audio, which is then aligned as before.
 */
export async function publishedPassage(reciterId: string, surah: number, start: number, end: number, audioUrl: string) {
  let source = audioUrl;
  try {
    const url = new URL(audioUrl);
    if (url.pathname === '/api/audio/proxy') source = url.searchParams.get('url') || '';
  } catch {
    return null;
  }
  const passage = await getRange(surah, start, end);
  if (!passage.length) return null;
  const choice = await reciterTiming(reciterId, surah, passage.map(verse => verse.verseKey));
  if (!choice.provider || choice.audioUrl !== source) return null;
  return {
    provider: choice.provider,
    passage: passage.map(verse => ({ verseKey: verse.verseKey, wordCount: verse.words.length })),
    timings: new Map(passage.map(verse => [verse.verseKey, choice.published(verse.verseKey)!]))
  };
}
