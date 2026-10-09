import { RECITERS, SURAHS_LIST } from './quranData';
import { getRange } from './quranCorpus';
import { qulSurah } from './qulRecitations';
import { chooseReciterTiming, type QuranComTimings, type TimingChoice } from './reciterTimingChoice';
import { timingPair } from './timingAudit';
import { publishedAyahBounds, soundTimings, type PublishedAyah } from './publishedPhrases';
import { measuredBounds, measuredRegions, type MeasuredRegion, type MeasuredSurah } from './measuredRecitations';

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
    reciter ? qulSurah(reciter.id, surah) : null,
    // Which of them fits which recording, as audited -- see `timingAudit`.
    reciter ? timingPair(reciter.id, surah) : undefined
  );
}

/**
 * Exports whose timings drift against the recording the studio plays, so that
 * each ayah is moved to where the aligner heard it -- see `heardOffset`.
 * Surveyed across every reciter (2026-10-08): only Hani ar-Rifai's QUL export,
 * up to 1.6s; the rest agree with their recordings within a quarter second.
 */
const DRIFTING_EXPORTS = new Set(['rifai']);

/**
 * The ayahs to give the aligner for a passage: the passage, and those either
 * side whose recitation is inside `window` (seconds).
 *
 * The studio pads the window ten seconds or more either side, and given only
 * the passage's text the aligner has nothing to put that audio on: on
 * Al-Sudais's 91:2-5, whose ayahs take three seconds each, it placed three
 * words of fourteen. Given the text of what is said there too, it hears the
 * neighbours as themselves.
 */
function ayahsAround(choice: TimingChoice, surah: number, start: number, end: number, window: { start: number; end: number }) {
  const ayahs = SURAHS_LIST.find(s => s.number === surah)?.numberOfAyahs ?? end;
  let first = start;
  let last = end;
  while (first > 1 && (choice.boundsFor(`${surah}:${first - 1}`)?.end ?? -Infinity) > window.start) first--;
  while (last < ayahs && (choice.boundsFor(`${surah}:${last + 1}`)?.start ?? Infinity) < window.end) last++;
  return { start: first, end: last };
}

/**
 * A passage's published timings, when `audioUrl` is the recording they were
 * measured on -- the studio's proxy address for it, from any origin, or the
 * address itself. Null for any other audio, which is then aligned as before.
 * With the aligner's `window`, also the ayahs to align over it: see `ayahsAround`.
 */
export async function publishedPassage(
  reciterId: string, surah: number, { start, end }: { start: number; end: number }, audioUrl: string, window?: { start: number; end: number }
) {
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
  // Timings past believing are no timings: the aligner times the passage.
  if (!soundTimings(passage.map(verse => ({ timing: choice.published(verse.verseKey), wordCount: verse.words.length })))) return null;
  return {
    provider: choice.provider,
    passage: passage.map(verse => ({ verseKey: verse.verseKey, wordCount: verse.words.length, words: verse.words.map(word => word.arabic) })),
    timings: new Map(passage.map(verse => [verse.verseKey, choice.published(verse.verseKey)!])),
    aligned: window ? ayahsAround(choice, surah, start, end, window) : { start, end },
    drifts: choice.provider === 'qul' && DRIFTING_EXPORTS.has(reciterId),
    regions: measuredRegions(reciterId, surah, start, end, source)
  };
}

/**
 * Where a load's estimated ayahs begin, in seconds, when it has no bounds to
 * show (0 when it has, as nothing is estimated): at the first ayah's published start, past believing as the
 * timings are, rather than at 0s -- from 0s, Shuraim's 12:75 loaded over the
 * surah's opening and the aligner read 12:1-6 there.
 */
export function estimatesFrom(
  repaired: Map<string, { start: number; end: number }> | null, choice: TimingChoice, firstAyah: { verse_key: string } | undefined
): number {
  if (repaired || !firstAyah) return 0;
  return choice.boundsFor(firstAyah.verse_key)?.start ?? 0;
}

/**
 * Each ayah's span for a reciter load, in seconds: this studio's own
 * measurement where it has one, else the published timings repaired as the
 * match repairs them, else none -- the timings past believing, and the aligner
 * times the passage from the recording.
 */
export function loadBounds(
  measured: MeasuredSurah | null,
  choice: TimingChoice,
  passage: PublishedAyah[],
  reciterId = ''
): Map<string, { start: number; end: number }> | null {
  if (measured) return measuredBounds(measured, passage.map(ayah => ayah.verseKey));
  if (!choice.provider) return null;
  const published = new Map(passage.flatMap(ayah => {
    const timing = choice.published(ayah.verseKey);
    return timing ? [[ayah.verseKey, timing] as const] : [];
  }));
  return publishedAyahBounds(passage, published, regionsOf(reciterId, choice, passage));
}

/** The measured stretches a load of `passage` holds (see `measuredRegions`). */
function regionsOf(reciterId: string, choice: TimingChoice, passage: PublishedAyah[]): MeasuredRegion[] {
  const [surah, first] = (passage[0]?.verseKey ?? '0:0').split(':').map(Number);
  const last = Number(passage[passage.length - 1]?.verseKey.split(':')[1]);
  return choice.audioUrl ? measuredRegions(reciterId, surah, first, last, choice.audioUrl) : [];
}
