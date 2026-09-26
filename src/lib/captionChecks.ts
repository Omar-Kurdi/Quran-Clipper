/**
 * Which captions to look at first after a match.
 *
 * Reviewing a match used to mean watching the whole clip, because nothing
 * said where the aligner was on thin ice. Two things do, measured against the
 * 166 captions of the ground-truth clips, 10 of them wrong (2026-09-27):
 *
 * - `stop_mark`: the sidecar ended the line on a mushaf stop mark and the
 *   alignment's own gap, with no silence heard there. 6 flagged, 3 wrong.
 * - `low_match`: the aligner's score for the caption is under `LOW_MATCH`.
 *   With the stop mark, 16 flagged and 4 of the 10 wrong -- one caption in
 *   ten to check, a quarter of them wrong, where one in seventeen is overall.
 *
 * What did not earn a mark: the Inspector's 0.75 (60 flagged, 4 wrong), a
 * restart and a stretch the aligner had to read again -- each about as likely
 * to point at a right caption as a wrong one, and a mark on a third of the
 * timeline is a mark nobody reads. Every clip exported with *Ground truth*
 * makes these numbers firmer; with 10 wrong captions they are a start.
 *
 * A mark goes once someone has dealt with the caption: "Looks right" in the
 * Inspector, or splitting or merging it (`checked`).
 */
import type { VerseData } from './quranData';

export type CaptionCheck = 'stop_mark' | 'low_match';

/** Below this the aligner's own score is worth a look. */
export const LOW_MATCH = 0.5;

/** The reasons to check this caption, or none. */
export function captionChecks(verse: Pick<VerseData, 'checks' | 'checked' | 'matchConfidence'>): CaptionCheck[] {
  if (verse.checked) return [];
  const reasons: CaptionCheck[] = [];
  if (verse.checks?.includes('stop_mark')) reasons.push('stop_mark');
  if (typeof verse.matchConfidence === 'number' && verse.matchConfidence < LOW_MATCH) reasons.push('low_match');
  return reasons;
}

/**
 * The next caption to check after `from`, wrapping round to the start, or
 * null when none is left. `from` itself comes last, so pressing the key on
 * the only flagged caption stays on it.
 */
export function nextToCheck(verses: VerseData[], from: number): number | null {
  const count = verses.length;
  for (let step = 1; step <= count; step++) {
    const i = (((from + step) % count) + count) % count;
    if (captionChecks(verses[i]).length) return i;
  }
  return null;
}

/** How many captions still want checking. */
export function toCheckCount(verses: VerseData[]): number {
  return verses.filter(verse => captionChecks(verse).length).length;
}

/** The timeline with this caption dealt with ("Looks right"), or the same array when it was not marked. */
export function markChecked(verses: VerseData[], index: number): VerseData[] {
  const verse = verses[index];
  if (!verse || !captionChecks(verse).length) return verses;
  return verses.map((v, i) => (i === index ? { ...v, checked: true } : v));
}
