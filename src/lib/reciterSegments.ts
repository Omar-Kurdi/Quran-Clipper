/**
 * A timeline built from the reciter's own published word timings.
 *
 * The studio has two ways to time a recitation, and both are inference: the
 * local aligner listens to the audio, and the manual path asks a person. For a
 * built-in reciter neither is necessary. Quran.com publishes measured segments
 * for these recordings -- `[word index, start ms, end ms]` per ayah -- and the
 * studio has been *asking for them* on every load (`segments=true`) and reading
 * only the ayah's outer bounds off the response. The words were already in the
 * payload and were being thrown away.
 *
 * So this is not a new source of truth so much as stopping the discard. What it
 * gives over an estimated or ayah-measured load is per-word times, which is what
 * splitting a caption accurately and hiding words on screen both want.
 *
 * It applies only to the built-in reciters, and deliberately: these timings
 * describe one specific recording. Against an uploaded file they would be
 * fiction, so nothing here is reachable from the upload path -- that keeps the
 * aligner exactly as it was.
 *
 * Times are absolute on the recording's own clock, milliseconds in and seconds
 * out, because that is the clock the timeline, the playhead, the canvas and the
 * exporter all read against.
 */

import { VerseData, VerseWord } from '@/lib/quranData';

/** One ayah as quran.com times it. `segments` may be absent for some ayahs. */
export interface ReciterVerseTiming {
  from: number;
  to: number;
  /** `[wordIndex, startMs, endMs]`, 1-based over the ayah's words. */
  segments?: number[][];
}

export interface SegmentSourceVerse {
  verseKey: string;
  verseNumber: number;
  textUthmani: string;
  translation: string;
  words: VerseWord[];
}

const seconds = (ms: number) => Math.round(ms) / 1000;
/** The convention the rest of the timeline stores segment edges at. */
const edge = (ms: number) => Math.round(ms / 100) / 10;

/**
 * How much of the passage the reciter actually timed, so the caller can refuse
 * a half-answer rather than build a timeline with holes in it.
 */
export interface SegmentBuild {
  verses: VerseData[];
  /** Ayahs that came back with per-word segments. */
  timedWords: number;
  /** Ayahs that had bounds but no word segments. */
  boundsOnly: number;
  /** Ayahs the reciter's data did not cover at all. */
  missing: number;
}

export function versesFromReciterSegments(
  passage: SegmentSourceVerse[],
  timings: Map<string, ReciterVerseTiming>
): SegmentBuild {
  const verses: VerseData[] = [];
  let timedWords = 0;
  let boundsOnly = 0;
  let missing = 0;

  for (const verse of passage) {
    const timing = timings.get(verse.verseKey);
    if (!timing || !(timing.to > timing.from)) {
      missing += 1;
      continue;
    }

    // `[index, start, end]`, one-based over this ayah's words. Some reciters
    // publish a fourth number; only the first three are ever read.
    const byIndex = new Map<number, [number, number]>();
    for (const segment of timing.segments || []) {
      const [index, start, end] = segment;
      if (!Number.isFinite(index) || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end <= start) continue;
      byIndex.set(index, [start, end]);
    }

    const words: VerseWord[] = verse.words.map((word, position) => {
      const found = byIndex.get(position + 1);
      // The word's own start. An end is not stored: the timeline's shape is a
      // start per word, and the next word's start is where this one stops.
      return found ? { ...word, timestamp: seconds(found[0]) } : { ...word };
    });

    const anyTimed = words.some(word => typeof word.timestamp === 'number');
    if (anyTimed) timedWords += 1;
    else boundsOnly += 1;

    verses.push({
      verseNumber: verse.verseNumber,
      verseKey: verse.verseKey,
      textUthmani: verse.textUthmani,
      translation: verse.translation,
      startTime: edge(timing.from),
      endTime: Math.max(edge(timing.to), edge(timing.from) + 0.1),
      words
    });
  }

  return { verses, timedWords, boundsOnly, missing };
}
