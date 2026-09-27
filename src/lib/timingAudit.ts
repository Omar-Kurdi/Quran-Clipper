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
import type { TimingPair } from './reciterTimingChoice';

type Entry = 'quran.com' | 'qul' | ['quran.com' | 'qul', string] | null;
const TABLE = pairs as unknown as Record<string, Record<string, Entry>>;

/**
 * The audited pairing for one reciter's surah: `undefined` when it was never
 * audited (the old order then applies), `null` when no timings fit any
 * recording (none are used).
 */
export function timingPair(reciterId: string, surah: number): TimingPair | undefined {
  const entry = TABLE[reciterId]?.[String(surah)];
  if (entry === undefined) return undefined;
  if (entry === null) return null;
  return typeof entry === 'string' ? { timings: entry } : { timings: entry[0], audioUrl: entry[1] };
}
