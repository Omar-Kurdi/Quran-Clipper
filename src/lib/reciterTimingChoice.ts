import type { ReciterVerseTiming } from './reciterSegments';

/** quran.com's timings for one chapter recording, as `fetchReciterTimings` returns them. */
export interface QuranComTimings {
  audioUrl: string;
  totalSeconds: number;
  timings: Map<string, { start: number; end: number }>;
}

/** QUL's timings for one surah, as `qulSurah` returns them -- milliseconds. */
export interface QulTimings {
  audioUrl: string;
  timings: Map<string, ReciterVerseTiming>;
  lastMs: number;
}

export interface TimingChoice {
  /** Whose measurements the load uses; null when the boundaries are estimated. */
  provider: 'quran.com' | 'qul' | null;
  /** The recording those measurements belong to, or null to keep the default one. */
  audioUrl: string | null;
  totalSeconds: number | null;
  /** One ayah's bounds in seconds, on that recording's clock. */
  boundsFor: (verseKey: string) => { start: number; end: number } | null;
}

/**
 * Which timings a reciter load uses: quran.com's where it has timed every ayah
 * asked for, then QUL's, then none.
 *
 * All or nothing per source. A half-timed range would mix absolute timestamps
 * with offsets counted from zero, which is worse than either. And the audio
 * travels with the timings: each source measured its own recording, and a
 * start time from one is fiction against the other.
 */
export function chooseReciterTiming(
  verseKeys: string[],
  quranCom: QuranComTimings | null,
  qul: QulTimings | null
): TimingChoice {
  if (quranCom && verseKeys.every(key => quranCom.timings.has(key))) {
    return {
      provider: 'quran.com',
      audioUrl: quranCom.audioUrl,
      totalSeconds: quranCom.totalSeconds || null,
      boundsFor: key => quranCom.timings.get(key) ?? null,
    };
  }
  if (qul && verseKeys.every(key => qul.timings.has(key))) {
    return {
      provider: 'qul',
      audioUrl: qul.audioUrl,
      totalSeconds: qul.lastMs / 1000,
      boundsFor: key => {
        const timing = qul.timings.get(key);
        return timing ? { start: timing.from / 1000, end: timing.to / 1000 } : null;
      },
    };
  }
  return { provider: null, audioUrl: null, totalSeconds: null, boundsFor: () => null };
}
