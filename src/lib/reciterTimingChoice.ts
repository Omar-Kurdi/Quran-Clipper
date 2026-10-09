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
 * Longer than any ayah is recited: the longest, 2:282, runs about four minutes
 * at the slowest of these reciters. An ayah timed longer than this is a smear
 * of its bounds, not a recitation.
 */
export const MAX_AYAH_MS = 10 * 60_000;

/**
 * An ayah's timing with its implausible words left out.
 *
 * One smeared word used to cost the whole ayah its timings, and with it every
 * passage containing it: Ghamdi's 3:188 times word 13 at 256s, Sudais's 4:176
 * word 50 at 101s, Ghamdi's 11:14 word 1 from 0s for 260s, and those passages
 * loaded estimated. The ayahs' own bounds are right -- aligned against the
 * recordings (2026-10-08) every one is within 0.3s of where the ayah is heard,
 * Al-Rifai's 5:41 within 4s of a pause -- so only the word is dropped; the
 * caption stands on the ayah's bounds and the rest of its words.
 */
function withoutImplausibleWords<T extends { segments?: number[][] }>(timing: T): T {
  if (!timing.segments || plausibleWords(timing.segments)) return timing;
  return { ...timing, segments: timing.segments.filter(([, start, end]) => !(end - start > MAX_WORD_MS)) };
}

/**
 * An ayah's timing with the words it can use: implausible ones left out, and
 * none at all when most of them lie outside the ayah's own bounds.
 *
 * quran.com lists Saud ash-Shuraim's 12:75 with its words running fifteen
 * seconds past its own end and 12:76 with none, while both ayahs' bounds are
 * right -- the phoneme model hears each begin within 0.7s of them. Kept, the
 * words made the passage unbelievable (`soundTimings`), and it loaded at 0s.
 * Without them, each ayah is one caption on its own bounds.
 */
function usableWords<T extends { from: number; to: number; segments?: number[][] }>(timing: T): T {
  const kept = withoutImplausibleWords(timing);
  if (!kept.segments?.length) return kept;
  const inside = kept.segments.filter(([, start]) => start >= kept.from - 1000 && start <= kept.to + 1000).length;
  return inside < kept.segments.length / 2 ? { ...kept, segments: undefined } : kept;
}

/**
 * Which timings to use for one reciter's surah, and with which recording, as
 * the audit found it (`timingAudit`). `audioUrl` is set when the timings fit
 * the other source's recording rather than their own -- QUL's Sudais
 * Al-Ma'idah was measured on the quranicaudio file, not the tarteel one its
 * export names. Null when no timings fit any recording.
 */
export type TimingPair = { timings: 'quran.com' | 'qul'; audioUrl?: string } | null;

/** Whether an ayah's bounds are a recitation's: quran.com's in seconds, QUL's in milliseconds. */
function plausibleAyah(timing: { start?: number; end?: number; from?: number; to?: number }): boolean {
  const ms = timing.from !== undefined ? (timing.to ?? 0) - timing.from : ((timing.end ?? 0) - (timing.start ?? 0)) * 1000;
  return ms > 0 && ms <= MAX_AYAH_MS;
}

/** The ayah before `verseKey` in its surah. */
const ayahBefore = (verseKey: string) => {
  const [surah, ayah] = verseKey.split(':');
  return `${surah}:${Number(ayah) - 1}`;
};

/** How far an ayah may be listed as starting inside the one before it and still be read as published. */
const OVERLAP_MS = 1000;

/**
 * An ayah's timing started where it is said, when the export starts it more
 * than a second inside the ayah before: at the later of where that one ends
 * and where its own first word is listed.
 *
 * Listened to with the phoneme model (2026-10-09), 21 ayahs across every
 * reciter's timings overlap so, and in each one that could be heard the ayah
 * begins where the one before it ends, not where it is listed: Ghamdi's 55:2
 * is listed from 0s inside 55:1 and heard at 4.4s, after 55:1's end at 4.1s;
 * Abdul Basit's 42:3 from 14.8s and heard at 17.1s, after 42:2's end at 16.8s.
 * Such a passage was refused as unbelievable (`soundTimings`), and one opening
 * on the ayah was not even seen to overlap.
 *
 * An ayah listed before the one before it altogether -- Abdul Basit's 55:70,
 * a minute after 55:71 -- is left as it is: which of the two is wrong, the
 * timings do not say.
 */
function withoutOverlapBefore(timing: ReciterVerseTiming, previous: ReciterVerseTiming | undefined): ReciterVerseTiming {
  if (!previous || !(timing.from < previous.to - OVERLAP_MS) || previous.from > timing.from) return timing;
  const firstWord = [...(timing.segments ?? [])].sort((a, b) => a[1] - b[1]).find(([index]) => index === 1)?.[1] ?? timing.from;
  const from = Math.max(firstWord, previous.to);
  if (!(from < timing.to)) return timing;
  return { ...timing, from, segments: timing.segments?.filter(([, start]) => start >= from - 300) };
}

const NO_TIMING: TimingChoice = { provider: null, audioUrl: null, totalSeconds: null, boundsFor: () => null, published: () => null };

function fromQuranCom(quranCom: QuranComTimings, audioUrl: string): TimingChoice {
  return {
    provider: 'quran.com',
    audioUrl,
    totalSeconds: quranCom.totalSeconds || null,
    boundsFor: key => quranCom.timings.get(key) ?? null,
    published: key => {
      const inMs = (timing: { start: number; end: number; segments?: number[][] } | undefined) =>
        timing && { from: timing.start * 1000, to: timing.end * 1000, segments: timing.segments };
      const timing = inMs(quranCom.timings.get(key));
      return timing ? usableWords(withoutOverlapBefore(timing, inMs(quranCom.timings.get(ayahBefore(key))))) : null;
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
    published: key => {
      const timing = qul.timings.get(key);
      return timing ? usableWords(withoutOverlapBefore(timing, qul.timings.get(ayahBefore(key)))) : null;
    },
  };
}

/**
 * Which timings a reciter load uses: quran.com's where it has timed every ayah
 * asked for, then QUL's, then none.
 *
 * All or nothing per source. A half-timed range would mix absolute timestamps
 * with offsets counted from zero, which is worse than either. A source whose
 * timing of any ayah in the range is broken -- the ayah itself timed longer
 * than any is recited -- counts as not covering it; a word running implausibly
 * long is only left out (`withoutImplausibleWords`). And the audio
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
  const covers = (timings: Map<string, { start?: number; end?: number; from?: number; to?: number }> | undefined) =>
    !!timings && verseKeys.every(key => timings.has(key) && plausibleAyah(timings.get(key)!));
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
