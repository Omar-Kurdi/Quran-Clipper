import type { ReciterVerseTiming } from './reciterSegments';

/** quran.com's timings for one chapter recording, as `fetchReciterTimings` returns them. */
export interface QuranComTimings {
  audioUrl: string;
  totalSeconds: number;
  /** Seconds, with quran.com's word segments (milliseconds) where it published them. */
  timings: Map<string, { start: number; end: number; segments?: number[][] }>;
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
  /** One ayah as published -- milliseconds, word segments included -- for splitting it into phrases. */
  published: (verseKey: string) => ReciterVerseTiming | null;
}

/**
 * Longer than any word is held. The longest real ones are the opening letters
 * of a surah (Alif-Lam-Mim-Sad, 7:1) at 10-15s; the published exports also
 * carry the odd smear -- one word of Shuraim's 2:144 runs 2026s, one of
 * Ghamdi's 3:188 256s -- which, taken as given, pushes every word after it
 * minutes out of place.
 */
export const MAX_WORD_MS = 30_000;

/** Whether no word in these segments runs past `MAX_WORD_MS`. */
export function plausibleWords(segments: number[][] | undefined): boolean {
  return (segments || []).every(([, start, end]) => !(end - start > MAX_WORD_MS));
}

/**
 * Which timings to use for one reciter's surah, and with which recording, as
 * the audit found it (`timingAudit`). `audioUrl` is set when the timings fit
 * the other source's recording rather than their own -- QUL's Sudais
 * Al-Ma'idah was measured on the quranicaudio file, not the tarteel one its
 * export names. Null when no timings fit any recording.
 */
export type TimingPair = { timings: 'quran.com' | 'qul'; audioUrl?: string } | null;

const NO_TIMING: TimingChoice = { provider: null, audioUrl: null, totalSeconds: null, boundsFor: () => null, published: () => null };

function fromQuranCom(quranCom: QuranComTimings, audioUrl: string): TimingChoice {
  return {
    provider: 'quran.com',
    audioUrl,
    totalSeconds: quranCom.totalSeconds || null,
    boundsFor: key => quranCom.timings.get(key) ?? null,
    published: key => {
      const timing = quranCom.timings.get(key);
      return timing ? { from: timing.start * 1000, to: timing.end * 1000, segments: timing.segments } : null;
    },
  };
}

function fromQul(qul: QulTimings, audioUrl: string): TimingChoice {
  return {
    provider: 'qul',
    audioUrl,
    totalSeconds: qul.lastMs / 1000,
    boundsFor: key => {
      const timing = qul.timings.get(key);
      return timing ? { start: timing.from / 1000, end: timing.to / 1000 } : null;
    },
    published: key => qul.timings.get(key) ?? null,
  };
}

/**
 * Which timings a reciter load uses: quran.com's where it has timed every ayah
 * asked for, then QUL's, then none.
 *
 * All or nothing per source. A half-timed range would mix absolute timestamps
 * with offsets counted from zero, which is worse than either. A source whose
 * timing of any ayah in the range is broken -- a word running implausibly
 * long -- counts as not covering it. And the audio
 * travels with the timings: each source measured one recording, and a start
 * time from one is fiction against another.
 *
 * Which recording that is was assumed, and was wrong often enough to matter:
 * quran.com's file for a surah has been replaced since it was timed, and QUL's
 * export names a file its timings do not fit. So where the surah was audited,
 * `pair` decides -- that source only, with that recording -- and the order
 * above applies only to a surah never audited.
 */
export function chooseReciterTiming(
  verseKeys: string[],
  quranCom: QuranComTimings | null,
  qul: QulTimings | null,
  pair?: TimingPair
): TimingChoice {
  const covers = (timings: Map<string, { segments?: number[][] }> | undefined) =>
    !!timings && verseKeys.every(key => timings.has(key) && plausibleWords(timings.get(key)!.segments));
  if (pair === null) return NO_TIMING;
  if (pair) {
    if (pair.timings === 'quran.com' && quranCom && covers(quranCom.timings)) {
      return fromQuranCom(quranCom, pair.audioUrl ?? quranCom.audioUrl);
    }
    if (pair.timings === 'qul' && qul && covers(qul.timings)) return fromQul(qul, pair.audioUrl ?? qul.audioUrl);
    return NO_TIMING;
  }
  if (quranCom && covers(quranCom.timings)) return fromQuranCom(quranCom, quranCom.audioUrl);
  if (qul && covers(qul.timings)) return fromQul(qul, qul.audioUrl);
  return NO_TIMING;
}
