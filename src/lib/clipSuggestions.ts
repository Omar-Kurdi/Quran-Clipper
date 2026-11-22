/**
 * Clips suggested from a recording's ayah map: its ayahs, in order, grouped
 * into runs about as long as asked -- whole ayahs only, each run ending where
 * the reciter pauses longest near that length -- for picking a recording's
 * clips at once rather than finding each by hand.
 *
 * No run is longer than a Short can be. An ayah longer than that on its own
 * is a run of its own; the platforms' readout says where it will not fit.
 */

import type { VerseData } from './quranData';
import { ayahList, ayahWindow } from './recordingClips';

/** The lengths offered, in seconds: Reels-short to a full three-minute Short. */
export const SUGGESTION_TARGETS = [30, 60, 90, 180] as const;
/** As long as a YouTube Short may be; no suggestion is longer. */
export const MAX_SUGGESTION_SEC = 180;

export interface Suggestion {
  /** The first and last ayah, as keys. */
  from: string;
  to: string;
  /** Its stretch of the recording, opened and closed in the pauses around it. */
  start: number;
  end: number;
}

/**
 * The map's ayahs grouped into suggested clips about `target` seconds long.
 * Each run takes the ayahs that bring it closest to `target`, a longer pause
 * after an ayah counting in its favour as an end, and never past
 * `MAX_SUGGESTION_SEC` unless one ayah alone is.
 */
export function suggestClips(map: VerseData[], target: number, duration: number): Suggestion[] {
  const ayahs = ayahList(map).map(ayah => ({
    ...ayah,
    start: map[ayah.first].startTime,
    end: map[ayah.last].endTime,
  }));
  const pauseAfter = (i: number) => (i + 1 < ayahs.length ? Math.max(0, ayahs[i + 1].start - ayahs[i].end) : 2);
  const limit = Math.min(MAX_SUGGESTION_SEC, Math.max(target * 1.5, target + 10));
  const out: Suggestion[] = [];
  for (let i = 0; i < ayahs.length;) {
    let best = i;
    let bestScore = Infinity;
    for (let j = i; j < ayahs.length; j++) {
      const length = ayahs[j].end - ayahs[i].start;
      if (j > i && length > limit) break;
      // How far from the length asked, less a little for ending on a long pause.
      const score = Math.abs(length - target) / target - Math.min(pauseAfter(j), 2) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    const window = ayahWindow(map, ayahs[i].first, ayahs[best].last, duration);
    if (window) out.push({ from: ayahs[i].key, to: ayahs[best].key, ...window });
    i = best + 1;
  }
  return out;
}

/** A suggestion's name for ticking it: its first and last ayah. */
export const suggestionId = (suggestion: Pick<Suggestion, 'from' | 'to'>) => `${suggestion.from}-${suggestion.to}`;

/** Its ayahs as shown: `3:20` or `3:20–22`. */
export const suggestionLabel = (suggestion: Pick<Suggestion, 'from' | 'to'>) =>
  suggestion.from === suggestion.to ? suggestion.from : `${suggestion.from}–${suggestion.to.split(':')[1]}`;
