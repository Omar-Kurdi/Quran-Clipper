/**
 * Which published timings belong to which recording, reciter by reciter.
 *
 * A source's ayah timings were trusted to match the file it names, and often
 * do not: quran.com's Sudais Al-Ma'idah was timed on a file since replaced, so
 * from 5:41 on every caption played 12-36s ahead of its ayah; QUL's timings
 * for it fit the quranicaudio file exactly and name a tarteel file 126s
 * shorter. Nothing in the data gives it away -- only the recordings do.
 *
 * `scripts/audit_timing_pairs.py` pairs each source's timings with the
 * recording whose length they end at, and writes `timingPairs.json`. It is
 * committed rather than worked out at run time, because a studio set to use
 * the published timings alone never reads the audio at all. Re-run it when a
 * CDN changes a file.
 */
import pairs from './timingPairs.json';
import fallbacks from './timingFallbacks.json';
import type { TimingPair } from './reciterTimingChoice';
import { RECITERS } from './quranData';

type Source = 'quran.com' | 'qul';
const isSource = (value: unknown): value is Source => value === 'quran.com' || value === 'qul';

/** One table entry, read without trusting its shape. */
function readEntry(entry: unknown): TimingPair | undefined {
  if (entry === null) return null;
  if (isSource(entry)) return { timings: entry };
  if (Array.isArray(entry) && isSource(entry[0]) && typeof entry[1] === 'string') return { timings: entry[0], audioUrl: entry[1] };
  return undefined;
}

/**
 * The audited pairing for one reciter's surah: `undefined` when it was never
 * audited (the old order then applies), `null` when no timings fit any
 * recording (none are used).
 */
export function timingPair(reciterId: string, surah: number): TimingPair | undefined {
  const surahs: Record<string, unknown> | undefined = (pairs as Record<string, Record<string, unknown>>)[reciterId];
  const pair = readEntry(surahs?.[String(surah)]);
  // Where QUL's own pairing was audited for a quran.com surah and fits.
  const qulFits = (fallbacks as Record<string, number[]>)[reciterId]?.includes(surah);
  return pair?.timings === 'quran.com' && !pair.audioUrl && qulFits ? { ...pair, qulFallback: true } : pair;
}

/**
 * Whether quran.com's timings for this surah may be used as they come, with
 * quran.com's own recording: where the audit found they fit it, or where it
 * never looked.
 */
export function quranComFits(quranApiId: number, surah: number): boolean {
  const reciterId = RECITERS.find(r => r.quranApiId === quranApiId)?.id;
  const pair = reciterId ? timingPair(reciterId, surah) : undefined;
  return pair === undefined || (pair?.timings === 'quran.com' && !pair.audioUrl);
}
