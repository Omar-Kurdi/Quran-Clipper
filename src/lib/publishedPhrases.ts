/**
 * A timed reciter's passage as captions: the published word timings, split
 * where the reciter pauses.
 *
 * For a reciter with published timings the aligner is the less reliable of the
 * two sources. quran.com and QUL measured every word of that exact recording;
 * the aligner infers them, and it can get them wrong -- on Muaiqly's 12:1-7 it
 * dropped the عَلَيْكَ of 12:3 and put 12:4's لِى in its place, cutting an ayah
 * recited in one breath into three captions. What the published timings do not
 * say is where the reciter stopped: each word runs on into the next, so a
 * pause is folded into the word before it.
 *
 * So each source does the one thing it is good at. The words, and when each was
 * said, come from the published timings, and so does every ayah's start and
 * end. The aligner only suggests where to cut, and a cut is taken only when it
 * falls between two consecutive words of the same ayah and near where the
 * published timings put that boundary. Whatever else the aligner decided --
 * a word from another ayah, a skipped word, a boundary it misplaced -- is
 * ignored rather than shown, so every word of every ayah is on screen in order
 * whatever it did.
 *
 * A repeat needs no aligner: the published timings list the words again when
 * the reciter goes back over them, and the caption starts again there.
 */

import type { MatchResult, MatchSegment } from './matchTypes';
import type { ReciterVerseTiming } from './reciterSegments';

/**
 * How far the aligner's cut may sit from the published start of the word
 * after it. Generous, because the two measure different edges of the pause:
 * the aligner cuts at or in the silence, while the published boundary is at
 * its far end, the pause being counted as part of the word before it.
 */
export const CUT_TOLERANCE_SEC = 2;

/** One recited word, as published: a 1-based index into the ayah, milliseconds. */
interface RecitedWord {
  index: number;
  start: number;
  end: number;
}

/**
 * The ayah's words in the order they were recited, repeats included.
 *
 * One word listed twice in a row is one word, not a repeat: the published
 * timings cut a long madd into pieces -- most often an ayah's last word, which
 * Muaiqly's export splits 132 times -- and reciters do not go back over a
 * single word. Taken as a repeat, it flashed that word up as a caption of its own.
 */
function recitedWords(timing: ReciterVerseTiming, wordCount: number): RecitedWord[] {
  const words = (timing.segments || [])
    .map(([index, start, end]) => ({ index, start, end }))
    .filter(word => Number.isInteger(word.index) && word.index >= 1 && word.index <= wordCount && word.end > word.start)
    .sort((a, b) => a.start - b.start);
  return words.reduce<RecitedWord[]>((merged, word) => {
    const previous = merged[merged.length - 1];
    if (previous?.index === word.index) previous.end = Math.max(previous.end, word.end);
    else merged.push({ ...word });
    return merged;
  }, []);
}

/**
 * Where the aligner started a new phrase inside `verseKey`, carrying on from
 * the word before: the 1-based word it starts on, and when.
 */
function alignerCuts(aligned: MatchSegment[], verseKey: string): { word: number; at: number }[] {
  const cuts: { word: number; at: number }[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const before = aligned[i - 1];
    const after = aligned[i];
    if (before.verseKey !== verseKey || after.verseKey !== verseKey) continue;
    if (typeof before.endWordIndex !== 'number' || typeof after.startWordIndex !== 'number') continue;
    if (typeof after.startTime !== 'number' || after.startWordIndex !== before.endWordIndex + 1) continue;
    cuts.push({ word: after.startWordIndex + 1, at: after.startTime });
  }
  return cuts;
}

/** The position in `words` a cut lands on, or -1 when no boundary between those two words is near it. */
function cutPosition(words: RecitedWord[], cut: { word: number; at: number }): number {
  let best = -1;
  let bestGap = Infinity;
  for (let j = 1; j < words.length; j++) {
    if (words[j].index !== cut.word || words[j - 1].index !== cut.word - 1) continue;
    const gap = Math.abs(words[j].start / 1000 - cut.at);
    if (gap < bestGap) {
      best = j;
      bestGap = gap;
    }
  }
  return bestGap <= CUT_TOLERANCE_SEC ? best : -1;
}

/** One ayah's words as published, with the positions in them where a caption starts. */
interface AyahPlan {
  verseKey: string;
  wordCount: number;
  timing: ReciterVerseTiming;
  words: RecitedWord[];
  /** Positions in `words` a caption starts at, the first always 0. */
  starts: number[];
  /** Those of them where the reciter went back over words already said. */
  restarts: Set<number>;
}

function planAyah(verseKey: string, wordCount: number, timing: ReciterVerseTiming, aligned: MatchSegment[]): AyahPlan {
  const words = recitedWords(timing, wordCount);
  const restarts = new Set<number>();
  for (let j = 1; j < words.length; j++) if (words[j].index <= words[j - 1].index) restarts.add(j);
  const pauses = alignerCuts(aligned, verseKey).map(cut => cutPosition(words, cut)).filter(j => j > 0);
  const starts = [0, ...[...new Set([...restarts, ...pauses])].sort((a, b) => a - b)];
  return { verseKey, wordCount, timing, words, starts, restarts };
}

/**
 * The `n`th caption of a planned ayah.
 *
 * Every word of the ayah is on screen somewhere: the first caption starts at
 * the ayah's first word and the last one ends at its last, whatever the
 * timings left out. A caption the next one carries on from ends where that one
 * starts; one the reciter went back from ends where they broke off.
 */
function captionAt(plan: AyahPlan, n: number): MatchSegment {
  const { verseKey, wordCount, timing, words, starts, restarts } = plan;
  const first = starts[n];
  const next: number | undefined = starts[n + 1];
  const last = (next ?? words.length) - 1;
  const lo = n === 0 ? 1 : words[first].index;
  const hi = next === undefined ? wordCount : restarts.has(next) ? words[last].index : words[next].index - 1;
  const start = n === 0 ? Math.min(timing.from, words[0].start) : words[first].start;
  const end = next === undefined ? Math.max(timing.to, words[last].end) : words[next].start;
  const [surahNumber, verseNumber] = verseKey.split(':').map(Number);
  return {
    verseKey,
    surahNumber,
    verseNumber,
    confidence: 1,
    startTime: start / 1000,
    endTime: end / 1000,
    startWordIndex: lo - 1,
    endWordIndex: hi - 1,
    wordTimings: words.slice(first, last + 1).map(word => ({ index: word.index - 1, start: word.start / 1000, end: word.end / 1000 })),
    notes: restarts.has(first) ? 'restarted phrase' : undefined
  };
}

/**
 * Captions for `passage` from its published timings, cut where `aligned` saw
 * the reciter pause. `aligned` is the aligner's result in recited order, and
 * may be empty: the ayahs are then split only where the reciter repeated.
 *
 * Null when any ayah has no published timing, so the caller never shows a
 * passage that is partly measured and partly not.
 */
export function phrasesFromPublished(
  passage: { verseKey: string; wordCount: number }[],
  published: Map<string, ReciterVerseTiming>,
  aligned: MatchSegment[]
): MatchSegment[] | null {
  const captions: MatchSegment[] = [];
  for (const { verseKey, wordCount } of passage) {
    const timing = published.get(verseKey);
    if (!timing || !(timing.to > timing.from) || wordCount < 1) return null;
    const plan = planAyah(verseKey, wordCount, timing, aligned);
    if (!plan.words.length) {
      // Bounds without words: the ayah whole, as the load already had it.
      const [surahNumber, verseNumber] = verseKey.split(':').map(Number);
      captions.push({
        verseKey, surahNumber, verseNumber, confidence: 1,
        startTime: timing.from / 1000, endTime: timing.to / 1000, startWordIndex: 0, endWordIndex: wordCount - 1
      });
      continue;
    }
    captions.push(...plan.starts.map((_, n) => captionAt(plan, n)));
  }
  return captions;
}

/**
 * The aligner's result for a timed reciter, replaced by the published timings
 * cut at the pauses it heard. A result the aligner itself doubts says nothing
 * reliable about pauses either, so then, as with no result at all, each ayah
 * is one caption.
 */
export function timedFromPublished(
  published: { provider: string; passage: { verseKey: string; wordCount: number }[]; timings: Map<string, ReciterVerseTiming> },
  aligned: MatchResult
): { result: MatchResult; pausesFromAudio: boolean } {
  const heard = aligned.segments.length > 0 && !aligned.warning;
  const captions = phrasesFromPublished(published.passage, published.timings, heard ? aligned.segments : []);
  if (!captions) return { result: aligned, pausesFromAudio: false };
  return {
    pausesFromAudio: heard,
    result: {
      audioDuration: aligned.audioDuration,
      confidence: 1,
      segments: captions,
      notes: `Timed from ${published.provider}'s published word timings, ` +
        (heard ? 'cut where the aligner heard the reciter pause.' : 'one caption per ayah.')
    }
  };
}
