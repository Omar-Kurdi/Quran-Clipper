/**
 * Captions this studio measured itself, for the few built-in recordings whose
 * published timings do not fit them.
 *
 * The audit (`scripts/audit_timing_pairs.py`) found three: Hani al-Rifai's
 * An-Nahl and Khalid al-Jalil's 103-104. Neither quran.com nor QUL times them
 * right -- QUL puts 104:4 eight seconds early, over the reciter going back
 * through 104:2-3 -- so they loaded estimated, or for a QUL-only reciter not at
 * all. Each was aligned against its recording chained ayah by ayah, every
 * caption start checked by the phoneme model hearing the ayah's opening words
 * there, and the result kept here: the captions as they are, repeats across
 * ayahs and the isti'adha included, which no per-ayah export can express.
 */

import measured from './measuredRecitations.json';
import stretches from './measuredRegions.json';
import type { HeardOpening } from './openings';
import type { MatchResult, MatchSegment } from './matchTypes';

export interface MeasuredSurah {
  audioUrl: string;
  openings: HeardOpening[];
  segments: MatchSegment[];
}

const surahs = measured as Record<string, Record<string, MeasuredSurah>>;

/** This studio's own captions for a reciter's surah, or null where the published timings are used. */
export function measuredSurah(reciterId: string, surah: number): MeasuredSurah | null {
  return surahs[reciterId]?.[String(surah)] ?? null;
}

/** The recording an address names, unwrapped from the studio's proxy. */
function recording(address: string): string {
  try {
    const url = new URL(address, 'http://studio.invalid');
    return url.pathname === '/api/audio/proxy' ? url.searchParams.get('url') || '' : address;
  } catch {
    return address;
  }
}

/**
 * A stretch of a surah the reciter read on into and then went back over,
 * measured as one: Khalid al-Jalil reads 44:43 to 44:49 and then all seven
 * again, and 82:17-19 twice over. Each ayah of it has one span in the
 * published timings, which cannot say that; these captions do, in the order
 * recited. Read by the aligner over the whole stretch and every caption
 * listened to (`scripts/reciters/`).
 */
export interface MeasuredRegion {
  /** Its first and last ayah. */
  ayahs: number[];
  audioUrl: string;
  segments: MatchSegment[];
}

const regions = stretches as Record<string, Record<string, MeasuredRegion[]>>;

/** The measured stretches of a reciter's recording that hold any of ayahs `start`..`end`. */
export function measuredRegions(reciterId: string, surah: number, start: number, end: number, audioUrl: string): MeasuredRegion[] {
  const source = recording(audioUrl);
  return (regions[reciterId]?.[String(surah)] ?? []).filter(
    region => region.audioUrl === source && region.ayahs[0] <= end && region.ayahs[1] >= start
  );
}

/** The captions of ayahs `start`..`end`, with the openings before a passage from the first ayah. */
export function measuredPassage(reciterId: string, surah: number, start: number, end: number, audioUrl: string): MatchResult | null {
  const held = measuredSurah(reciterId, surah);
  if (!held || recording(audioUrl) !== held.audioUrl) return null;
  const segments = held.segments.filter(segment => segment.verseNumber! >= start && segment.verseNumber! <= end);
  if (!segments.length) return null;
  return {
    segments,
    confidence: 1,
    openings: start === 1 ? held.openings : [],
    notes: "Timed from this studio's own measurement of the recording."
  };
}

/** Each ayah's span for a load: from its first caption to where the next ayah starts. */
export function measuredBounds(held: MeasuredSurah, verseKeys: string[]): Map<string, { start: number; end: number }> {
  const firstStart = new Map<string, number>();
  for (const segment of held.segments) if (!firstStart.has(segment.verseKey!)) firstStart.set(segment.verseKey!, segment.startTime!);
  const last = held.segments[held.segments.length - 1];
  const order = [...firstStart.keys()];
  const bounds = new Map<string, { start: number; end: number }>();
  for (const key of verseKeys) {
    const at = order.indexOf(key);
    if (at < 0) continue;
    const next = order[at + 1];
    bounds.set(key, { start: firstStart.get(key)!, end: next ? firstStart.get(next)! : last.endTime! });
  }
  return bounds;
}
