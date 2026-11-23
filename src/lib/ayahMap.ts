/**
 * The ayah map of a long recording: its captions, matched a stretch at a time
 * because the aligner cannot take an hour at once, and the one place a
 * caption is fixed.
 *
 * Every clip of the recording takes its captions from the map -- the map's
 * stretch, moved onto the clip's own clock -- and a fix made inside a clip is
 * written back into the map, so the next clip holding that ayah has it too.
 *
 * The stretches are cut in the reciter's pauses (`pauses.ts`), so no word is
 * split between two of them. Captions already there -- matched before, or
 * checked by hand in a clip -- are never replaced by a fresh match: a match
 * only fills what nothing covers yet. Pure, so the rules can be tested.
 */

import type { VerseData } from './quranData';
import { longestPauseIn, type Pause } from './pauses';
import { shiftTimeline, trimTimeline } from './verseEdits';
import { ayahList, ayahRangeWindow, ayahsHeld } from './recordingClips';

export interface Stretch {
  start: number;
  end: number;
}

/** About four and a half minutes: well inside what the aligner matches quickly, and a few ayahs of a long surah. */
export const MAP_WINDOW_SEC = 270;
/**
 * Longer than this, an upload is matched a part at a time, each part's
 * captions shown as it lands, rather than all at once at the end. Anything up
 * to six minutes is one part anyway (a 270 s part and a last one of at least
 * `MIN_LAST_SEC`), so it is matched whole.
 */
export const MAP_IN_PARTS_SEC = 6 * 60;

/** Whether a recording of `seconds` is matched in parts (`MAP_IN_PARTS_SEC`). */
export function matchesInParts(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds > MAP_IN_PARTS_SEC;
}

/** How far either side of a stretch's planned end its cut may move to land in a pause. */
const CUT_REACH_SEC = 45;
/** A last stretch shorter than this is joined to the one before. */
const MIN_LAST_SEC = 90;
/** How much of a stretch captions must already cover for it to need no match. */
const COVERED = 0.8;

/**
 * The stretches a recording of `duration` seconds is matched in, in order,
 * each about `windowSec` long and ending in the longest pause near its end.
 */
export function planMapWindows(duration: number, pauses: readonly Pause[], windowSec = MAP_WINDOW_SEC): Stretch[] {
  const windows: Stretch[] = [];
  let start = 0;
  while (start < duration - 0.5) {
    const planned = start + windowSec;
    if (planned >= duration - MIN_LAST_SEC) {
      windows.push({ start, end: duration });
      break;
    }
    const pause = longestPauseIn(pauses, planned - CUT_REACH_SEC, planned + CUT_REACH_SEC);
    const end = pause ? Math.round(((pause.start + pause.end) / 2) * 1000) / 1000 : planned;
    windows.push({ start, end });
    start = end;
  }
  return windows;
}

/** How much of `stretch` the captions cover, 0 to 1. */
export function coverage(verses: readonly Pick<VerseData, 'startTime' | 'endTime'>[], stretch: Stretch): number {
  const span = stretch.end - stretch.start;
  if (span <= 0) return 1;
  const parts = verses
    .map(verse => [Math.max(verse.startTime, stretch.start), Math.min(verse.endTime, stretch.end)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let reached = stretch.start;
  for (const [from, to] of parts) {
    if (to <= reached) continue;
    covered += to - Math.max(from, reached);
    reached = to;
  }
  return covered / span;
}

/** The stretches still to match: those the captions do not mostly cover already. */
export function windowsToMatch(windows: readonly Stretch[], verses: readonly Pick<VerseData, 'startTime' | 'endTime'>[]): Stretch[] {
  return windows.filter(window => coverage(verses, window) < COVERED);
}

/**
 * The map with `matched` added where nothing is yet: a matched caption most
 * of which an existing one already covers is left out, and every existing
 * caption stays exactly as it was.
 */
export function mergeIntoGaps(map: readonly VerseData[], matched: readonly VerseData[]): VerseData[] {
  const added = matched.filter(caption => coverage(map, { start: caption.startTime, end: caption.endTime }) < 0.5);
  return [...map, ...added].sort((a, b) => a.startTime - b.startTime);
}

/** The longest pause a caption is held across at a join between two parts. */
const HOLD_ACROSS_SEC = 10;

/**
 * The map with the caption before a join between two parts (`at`, where they
 * were cut) held until the one after it starts, as a match of the whole holds
 * a caption through a pause. Each part's captions end where its last word
 * does, so the pause the parts were cut in showed nothing at all. A gap longer
 * than `HOLD_ACROSS_SEC`, or one with no caption on either side, is left.
 */
export function holdAcrossJoin(map: readonly VerseData[], at: number): VerseData[] {
  const before = map.reduce<number>((found, caption, i) =>
    caption.endTime <= at + 0.05 && (found < 0 || caption.endTime > map[found].endTime) ? i : found, -1);
  const after = map.find(caption => caption.startTime >= at - 0.05);
  if (before < 0 || !after) return [...map];
  const gap = after.startTime - map[before].endTime;
  if (gap <= 0 || gap > HOLD_ACROSS_SEC) return [...map];
  return map.map((caption, i) => (i === before ? { ...caption, endTime: after.startTime } : caption));
}

/**
 * The recording's captions with one stretch of it given new ones: those
 * inside `window` give way to `replacement`, those outside it stay as they
 * were, and one reaching into it from either side is cut back to its edge.
 */
export function mergeWindowTimeline(
  verses: VerseData[], replacement: VerseData[], window: Stretch
): VerseData[] {
  if (!replacement.length) return verses;
  const from = Math.min(window.start, ...replacement.map(verse => verse.startTime));
  const to = Math.max(window.end, ...replacement.map(verse => verse.endTime));
  const kept = verses.flatMap(verse => {
    if (verse.endTime <= from || verse.startTime >= to) return [verse];
    // Mostly inside: the replacement has it.
    if (verse.startTime >= from && verse.endTime <= to) return [];
    const startTime = verse.startTime < from ? verse.startTime : to;
    const endTime = verse.startTime < from ? from : verse.endTime;
    return endTime - startTime >= 0.1 ? [{ ...verse, startTime, endTime }] : [];
  });
  return [...kept, ...replacement].sort((a, b) => a.startTime - b.startTime);
}

/** A clip's captions from the map: its stretch of the recording (`window`, on the recording's clock), on the clip's own. */
export function clipFromMap(map: VerseData[], window: Stretch): VerseData[] {
  return trimTimeline(map, window.start, window.end);
}

/** The map with a clip's captions written back over its stretch: a fix made in the clip, made in the recording. */
export function writeClipToMap(map: VerseData[], clipVerses: VerseData[], window: Stretch): VerseData[] {
  if (!clipVerses.length) return map;
  return mergeWindowTimeline(map, shiftTimeline(clipVerses, window.start), window);
}

/** The map seeded from clips already captioned: each clip's captions, on the recording's clock, where the map has none. */
export function seedFromClips(map: VerseData[], clips: { verses: VerseData[]; window: Stretch }[]): VerseData[] {
  return clips.reduce((seeded, clip) => mergeIntoGaps(seeded, shiftTimeline(clip.verses, clip.window.start)), map);
}

/**
 * A clip's stretch moved one whole ayah at one end, on the map: `by` -1 at
 * the start takes in the ayah before, +1 lets its first go; at the end, +1
 * takes in the next and -1 lets its last go. Opened and closed in the pauses
 * around the ayahs, as a clip by ayahs is (`ayahWindow`). Null when there is
 * no such ayah, or the clip would hold none.
 */
export function nudgedStretch(
  map: VerseData[], window: Stretch, edge: 'start' | 'end', by: -1 | 1, duration: number
): Stretch | null {
  const held = ayahsHeld(map, window);
  if (!held) return null;
  const ayahs = ayahList(map);
  let first = ayahs.findIndex(ayah => ayah.key === held.from);
  let last = ayahs.findIndex(ayah => ayah.key === held.to);
  if (edge === 'start') first += by;
  else last += by;
  if (first < 0 || last >= ayahs.length || first > last) return null;
  return ayahRangeWindow(map, ayahs[first].key, ayahs[last].key, duration);
}
