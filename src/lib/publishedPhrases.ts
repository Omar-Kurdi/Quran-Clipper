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
 * falls between two consecutive words of the same ayah, near where the
 * published timings put that boundary, and after a word the mushaf marks as a
 * place to stop (`STOP_SIGNS`). A level dip is not a pause: Al-Muaiqly holds
 * the closure of the ضّ in 1:7's ٱلضَّآلِّينَ, the aligner heard 0.3s of quiet
 * there, and 1:7 was cut after وَلَا -- right on the published boundary, so
 * only the text could tell it was no place to stop. An ayah with no such mark
 * is one caption; it breaks only at its end and where the reciter went back. Whatever else the aligner decided --
 * a word from another ayah, a skipped word, a boundary it misplaced -- is
 * ignored rather than shown, so every word of every ayah is on screen in order
 * whatever it did.
 *
 * A repeat needs no aligner: the published timings list the words again when
 * the reciter goes back over them, and the caption starts again there.
 */

import type { MatchResult, MatchSegment } from './matchTypes';
import type { ReciterVerseTiming } from './reciterSegments';
import type { MeasuredRegion } from './measuredRecitations';

/**
 * How far the aligner's cut may sit from the published start of the word
 * after it. Generous, because the two measure different edges of the pause:
 * the aligner cuts at or in the silence, while the published boundary is at
 * its far end, the pause being counted as part of the word before it.
 */
export const CUT_TOLERANCE_SEC = 2;

/**
 * The same, for a join the ayah's words pass only once (no repeat to choose
 * between): far enough for the drift measured in published words inside an
 * ayah, which reaches 3.1s in Al-Muaiqly's 66:9.
 */
const LONE_CUT_TOLERANCE_SEC = 5;

/**
 * The mushaf's signs that a reciter may stop here: ۖ ۗ ۘ ۚ ۛ. Not ۙ, which says
 * do not stop, nor ۜ, a breath-less pause.
 */
const STOP_SIGNS = /[\u06D6\u06D7\u06D8\u06DA\u06DB]\s*$/;

/** Whether the mushaf allows a stop after this word. */
export const stopAllowedAfter = (word: string | undefined): boolean => STOP_SIGNS.test((word || '').trim());

/** ۙ: the mushaf says do not stop here. */
const NO_STOP = /\u06D9\s*$/;

/**
 * A word whose ٱل, or whose hamzat al-waṣl alone, opens on a doubled letter --
 * ٱلضَّآلِّينَ, ٱلدِّينِ, ٱتَّبَعَ (Abdul Basit's 28:50, مِمَّنِ ٱتَّبَعَ). Coming into it the mouth closes on that letter, and the closure
 * is as quiet as a breath: Al-Muaiqly's 1:7 measures 0.36s of quiet before
 * ٱلضَّآلِّينَ, longer than Khalid al-Jalil's real breath in 12:86 (0.24s). No one
 * breathes there, so no caption ends there.
 */
const ABSORBED_DOUBLED = /^ٱ(?:ل)?[\u0621-\u064A][^\u0621-\u064A]*\u0651/;

/**
 * Whether the reciter may have breathed between these two words, where the
 * aligner heard a pause with no stop sign: Khalid al-Jalil breathes inside
 * 12:86 (ٱللَّهِ | وَأَعْلَمُ), 12:87 (وَأَخِيهِ | وَلَا) and 12:88 (ٱلضُّرُّ | وَجِئْنَا),
 * and a caption that carried on through each read as one breath where he took
 * two. The aligner's own rules -- and the Screen breaks setting -- decide
 * where it heard one; this only rules out the joins where it cannot be one.
 */
const breathAllowedBetween = (before: string | undefined, after: string | undefined): boolean =>
  !NO_STOP.test((before || '').trim()) && !ABSORBED_DOUBLED.test((after || '').trim()) && !heldNasalAcross(before || '', after || '');

const ARABIC_LETTER = /[\u0621-\u064A]/;
const SHORT_VOWELS = /[\u064E\u064F\u0650]/;
const TANWEEN = /[\u064B\u064C\u064D]/;
/** What a nūn sākinah or tanween is held into -- idghām with ghunnah, iqlāb, ikhfāʾ. */
const GHUNNAH_AFTER_NOON = new Set('يومنبتثجدذزسشصضطظفقك');
/** What a mīm sākinah is held into: idghām and ikhfāʾ shafawī. */
const GHUNNAH_AFTER_MEEM = new Set('مب');

/**
 * Whether tajweed holds a nasal across this join, the sidecar's
 * `_held_nasal_junction`: a hum as quiet as a breath, but no breath. Al-Muaiqly's
 * 23:59 وَٱلَّذِينَ هُم | بِرَبِّهِمْ and Al-Shuraim's 17:97 فَلَن | تَجِدَ were cut
 * there as breaths.
 */
function heldNasalAcross(first: string, second: string): boolean {
  const letters = [...first].filter(c => ARABIC_LETTER.test(c));
  const opening = [...second].find(c => ARABIC_LETTER.test(c));
  if (!letters.length || !opening) return false;
  const last = letters[letters.length - 1];
  const tail = first.slice(first.lastIndexOf(last) + 1);
  if (TANWEEN.test(first)) return GHUNNAH_AFTER_NOON.has(opening);
  if (last === '\u0646' && !SHORT_VOWELS.test(tail)) return GHUNNAH_AFTER_NOON.has(opening);
  if (last === '\u0645' && !SHORT_VOWELS.test(tail)) return GHUNNAH_AFTER_MEEM.has(opening);
  return false;
}

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
 *
 * Nothing comes before the ayah's first word. Some exports list words ahead of
 * it -- Ghamdi's 97:3 opens with a word 4 timed during the end of 97:2 -- and,
 * read as a repeat, that made a caption of its own before the ayah proper.
 * Reciters start an ayah at its beginning, so those are dropped.
 *
 * Nor does anything come after its last word, unless it gets back there. QUL
 * closes some ayahs with one more entry: a word from the middle stretched over
 * the silence before the next ayah -- Sudais's 5:40 ends on word 19 and then
 * lists word 11 for the last 1.1s, 5:48 word 38 for 0.26s. Read as a repeat,
 * each flashed up as a caption of its own. A reciter who really goes back at
 * the end of an ayah says it through to the last word again, so a tail that
 * never reaches it is dropped.
 */
function recitedWords(timing: ReciterVerseTiming, wordCount: number, heardRestart?: (atMs: number) => boolean): RecitedWord[] {
  const listed = (timing.segments || [])
    .map(([index, start, end]) => ({ index, start, end }))
    .filter(word => Number.isInteger(word.index) && word.index >= 1 && word.index <= wordCount && word.end > word.start)
    .sort((a, b) => a.start - b.start);
  const first = listed.findIndex(word => word.index === 1);
  const lastWord = listed.map(word => word.index).lastIndexOf(wordCount);
  // Only where word 1 comes before the last: Abdul Basit's 39:32 lists its
  // words 3 2 3 ... 15 and then word 1, and cutting at it left none at all.
  const from = first >= 0 && (lastWord < 0 || first <= lastWord) ? first : 0;
  const words = listed.slice(from, lastWord >= from ? lastWord + 1 : listed.length);
  const merged = words.reduce<RecitedWord[]>((kept, word) => {
    const previous = kept[kept.length - 1];
    if (previous?.index === word.index) previous.end = Math.max(previous.end, word.end);
    else kept.push({ ...word });
    return kept;
  }, []);
  return withSoundRestarts(merged, heardRestart);
}

/**
 * The words with every going-back that hangs together, and nothing else.
 *
 * The exports list some restarts scrambled: Al-Shatri's 6:59 reads
 * 27 28 26 25 24 27 28 29 where he went back to 24, Abdul Basit's 2:164
 * 40 39 37 38 40 41 where he went back to 37. Taken as given, each went-back
 * word was a restart of its own -- a caption one word long, flashing up out of
 * order. So a stretch that goes back is kept as recited when it reads forward
 * a word at a time (a restart, or several); put back in order, keeping its
 * times, when it names each word from where it went back to where it had got
 * exactly once; and
 * otherwise dropped, its time going to the word before it.
 *
 * Where the aligner listened, a going-back is kept only if it heard one there
 * too. The exports also mislabel words with no restart at all: Abdul Basit's
 * 39:32 lists its words 3 2 3 4 ..., word 1 missing, which read as a restart
 * after one word flashed the ayah's start up for 0.8s and began it again. The
 * aligner hears restarts in the recording itself (Khalid al-Jalil going back
 * over 104:2-3), so the two have to agree.
 */
function withSoundRestarts(words: RecitedWord[], heardRestart?: (atMs: number) => boolean): RecitedWord[] {
  const out: RecitedWord[] = [];
  let reached = 0;
  for (let i = 0; i < words.length;) {
    if (!out.length || words[i].index > reached) {
      reached = Math.max(reached, words[i].index);
      out.push(words[i++]);
      continue;
    }
    // An ayah opened on one word that is not its first, then gone back from:
    // a mislabel, not a restart after one word (Abdul Basit's 39:32, 3 2 3 4).
    if (out.length === 1 && out[0].index !== 1) {
      const [stray] = out.splice(0, 1);
      words[i] = { ...words[i], start: stray.start };
      reached = 0;
      continue;
    }
    // Everything up to where the reciter carries on past `reached`.
    let j = i;
    while (j < words.length && words[j].index <= reached) j++;
    const block = withoutRushedRuns(words.slice(i, j), out[out.length - 1]);
    const sound = !block.length || (heardRestart && !heardRestart(block[0].start)) ? null : soundBlock(block, reached);
    if (sound) out.push(...sound);
    else if (block.length) out[out.length - 1].end = Math.max(out[out.length - 1].end, block[block.length - 1].end);
    i = j;
  }
  return out;
}

/**
 * Closer than a reciter starts one word after another, on average, in anything
 * he goes back over. Listened to (2026-10-11): the tightest real repeats start
 * their words 200ms apart (Al-Shatri's 9:38, مَا لَكُمْ run together), while
 * Khalid al-Jalil's 25:16 lists words 2-4 again within 161ms at the end of
 * يَشَآءُونَ and Al-Muaiqly's 11:28 two words within 70ms -- said once each,
 * and shown as repeats they flashed up as captions of their own.
 */
const MIN_REPEAT_WORD_GAP_MS = 100;

/**
 * A gone-back stretch without the runs no one could have recited: words listed
 * in order but starting under `MIN_REPEAT_WORD_GAP_MS` apart. Their time goes
 * to the word before, as for any other stray.
 */
function withoutRushedRuns(block: RecitedWord[], before: RecitedWord): RecitedWord[] {
  const kept: RecitedWord[] = [];
  for (let k = 0; k < block.length;) {
    let e = k + 1;
    while (e < block.length && block[e].index === block[e - 1].index + 1) e++;
    const run = block.slice(k, e);
    const rushed = run.length >= 2 && (run[run.length - 1].start - run[0].start) / (run.length - 1) < MIN_REPEAT_WORD_GAP_MS;
    if (!rushed) kept.push(...run);
    else (kept[kept.length - 1] ?? before).end = Math.max((kept[kept.length - 1] ?? before).end, run[run.length - 1].end);
    k = e;
  }
  return kept;
}

/** A gone-back stretch as it was recited, or null when it does not hang together. */
function soundBlock(block: RecitedWord[], reached: number): RecitedWord[] | null {
  const runs: RecitedWord[][] = [];
  for (const word of block) {
    const run = runs[runs.length - 1];
    if (run && word.index === run[run.length - 1].index + 1) run.push(word);
    else runs.push([word]);
  }
  // A restart, or several, each read forward a word at a time.
  if (runs.every(run => run.length >= 2)) return block;
  // Each word from where it went back to where it had got, named once, out
  // of order: put in order.
  const indices = block.map(word => word.index).sort((a, b) => a - b);
  const once = indices.every((index, k) => index === indices[0] + k);
  if (!once || indices.length < 2 || indices[indices.length - 1] !== reached) return null;
  return block.map((word, k) => ({ ...word, index: indices[k] }));
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

/** Least disagreement worth correcting: the aligner itself reads a word 0.1-0.2s late. */
const MIN_OFFSET_MS = 500;
/** Most: anything larger is no offset but a different ayah, and the published timings stand. */
const MAX_OFFSET_MS = 2500;
/** How far the words may disagree among themselves about the offset, between quartiles. */
const MAX_OFFSET_SPREAD_MS = 400;

/**
 * How much later than published the aligner heard this ayah's words, in
 * milliseconds, when the words agree on it; 0 when they do not, or by little.
 *
 * QUL's timings for Hani al-Rifai sit up to 1.6s early against the recording
 * the studio plays, by an amount that wanders through a surah (54:31's caption
 * came up over 54:30's last word, وَنُذُرِ). The recording is constant-bitrate
 * and seeks exactly; the export was timed on another copy. Every word of an
 * ayah off by the same amount is that, and the ayah is moved by it.
 *
 * Only for an export known to drift (see `publishedPassage`): elsewhere the
 * aligner's own reading can be a word out throughout an ayah, as consistent
 * as a drift, and moving by it put Yasser ad-Dossary's 2:35, which quran.com
 * times right, 0.94s late.
 */
export function heardOffset(aligned: MatchSegment[], verseKey: string, timing: ReciterVerseTiming): number {
  const heard = new Map<number, number>();
  for (const segment of aligned) {
    if (segment.verseKey !== verseKey) continue;
    for (const word of segment.wordTimings ?? []) if (!heard.has(word.index)) heard.set(word.index, word.start * 1000);
  }
  const said = new Set<number>();
  const diffs: number[] = [];
  for (const [index, start] of [...(timing.segments ?? [])].sort((a, b) => a[1] - b[1])) {
    if (said.has(index)) continue;
    said.add(index);
    const at = heard.get(index - 1);
    if (at !== undefined) diffs.push(at - start);
  }
  if (diffs.length < Math.min(3, said.size) || diffs.length < 2) return 0;
  diffs.sort((a, b) => a - b);
  const quartile = (q: number) => diffs[Math.min(diffs.length - 1, Math.floor(q * (diffs.length - 1)))];
  const median = quartile(0.5);
  const agreed = quartile(0.75) - quartile(0.25) <= MAX_OFFSET_SPREAD_MS;
  return agreed && Math.abs(median) >= MIN_OFFSET_MS && Math.abs(median) <= MAX_OFFSET_MS ? median : 0;
}

/**
 * A moved ayah started no later than its first word was heard.
 *
 * A drift can begin inside an ayah: Al-Rifai's 24:58 is right to its word 3
 * and two seconds early from its word 7 on. Moved by the words' median, its
 * caption came up 1.7s after he had begun it.
 */
function openingAsHeard(
  moved: ReciterVerseTiming, published: ReciterVerseTiming, aligned: MatchSegment[], verseKey: string
): ReciterVerseTiming {
  const starts = aligned
    .filter(segment => segment.verseKey === verseKey)
    .flatMap(segment => (segment.wordTimings ?? []).filter(word => word.index === 0).map(word => word.start * 1000));
  if (!starts.length) return moved;
  const heard = Math.max(Math.min(...starts), published.from - 1000);
  return heard < moved.from ? { ...moved, from: heard } : moved;
}

/** An ayah's published timing moved by `ms`. */
function shifted(timing: ReciterVerseTiming, ms: number): ReciterVerseTiming {
  return {
    ...timing,
    from: timing.from + ms,
    to: timing.to + ms,
    segments: timing.segments?.map(([index, start, end, ...rest]) => [index, start + ms, end + ms, ...rest]),
  };
}

/** When the aligner heard the reciter go back inside `verseKey`, in seconds. */
function alignerRestarts(aligned: MatchSegment[], verseKey: string): number[] {
  const at: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const before = aligned[i - 1];
    const after = aligned[i];
    if (after.verseKey !== verseKey || typeof after.startTime !== 'number') continue;
    const wentBack = after.notes === 'restarted phrase'
      || (before.verseKey === verseKey && typeof after.startWordIndex === 'number' && typeof before.endWordIndex === 'number'
        && after.startWordIndex <= before.endWordIndex);
    if (wentBack) at.push(after.startTime);
  }
  // Inside one phrase too: the aligner can hear a going-back without starting a new phrase for it.
  const heard = heardWords(aligned, verseKey);
  for (let i = 1; i < heard.length; i++) if (heard[i].index <= heard[i - 1].index) at.push(heard[i].start / 1000);
  return at;
}

/** Every word the aligner heard of `verseKey`, in time order, as published words are: 1-based, milliseconds. */
function heardWords(aligned: MatchSegment[], verseKey: string): RecitedWord[] {
  const seen = new Set<number>();
  return aligned
    .filter(segment => segment.verseKey === verseKey)
    .flatMap(segment => segment.wordTimings ?? [])
    .map(word => ({ index: word.index + 1, start: Math.round(word.start * 1000), end: Math.round(word.end * 1000) }))
    .filter(word => !seen.has(word.start) && seen.add(word.start))
    .sort((a, b) => a.start - b.start);
}

/** The run of `words` from position `at` that reads forward a word at a time. */
function forwardRun(words: RecitedWord[], at: number): RecitedWord[] {
  let end = at + 1;
  while (end < words.length && words[end].index === words[end - 1].index + 1) end++;
  return words.slice(at, end);
}

/** How far the export's words may sit from the aligner's in the pass it lists: the aligner reads a word 0.1-0.2s late. */
const MAX_PASS_DISAGREEMENT_MS = 1000;
/** Least time a pass left out takes a word, on average, to be one the reciter said. */
const MIN_PASS_WORD_MS = 150;
/** How far past its ayah's published bounds a pass may run: the aligner's edges are a word's breadth out. */
const PASS_BOUND_SLACK_MS = 300;
/** Shortest a pass's first word can be and be said: the aligner's slivers are 20ms. */
const MIN_OPENING_WORD_MS = 50;
/** Most of a pass left out that may measure as quiet. */
const MAX_PASS_QUIET = 0.75;

/** Whether the reciter was silent for `MIN_GAP_SEC` just before `at`, in seconds. */
function silentBefore(quiet: [number, number][], at: number): boolean {
  return quiet.some(([from, to]) => to - from >= MIN_GAP_SEC && from < at && at - to <= 0.3);
}

/** How much of `from`-`to`, in seconds, measures as quiet. */
function quietWithin(quiet: [number, number][], from: number, to: number): number {
  return quiet.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
}

/**
 * The published timing with any pass over repeated words it leaves out, from
 * the aligner's own times.
 *
 * QUL lists some of Khalid al-Jalil's repeats once: in 12:46 he says
 * يَأْكُلُهُنَّ سَبْعٌ عِجَافٌ, stops, and says it again, and the export times
 * only the second; in 12:47 فَذَرُوهُ فِى سُنۢبُلِهِۦٓ likewise. With no going-back
 * in the published words there was no restart to start a caption at, and the
 * word before was lit through the whole first pass. The aligner hears both.
 *
 * Only where it is plain: each pass two words or more (a reciter does not go
 * back over a single word), the reciter silent for `MIN_GAP_SEC` just before
 * going back, the words' first word listed once, the pass it lists where the
 * aligner heard it, each pass opening on a word said, the pass left out said
 * in full (not squeezed, not in silence), inside the ayah's published bounds,
 * and no published word starting inside it.
 */
function withHeardRepeats(
  timing: ReciterVerseTiming, aligned: MatchSegment[], verseKey: string, quiet: [number, number][]
): ReciterVerseTiming {
  const heard = heardWords(aligned, verseKey);
  const listed = (timing.segments ?? []).map(([index, start, end]) => ({ index, start, end }));
  const found = heard.map((_, i) => passLeftOut(heard, i, { ...timing, listed }, quiet)).filter(pass => pass !== null);
  if (!found.length) return timing;
  // The word listed before a pass left out was stretched over it, and the
  // silence before it; it ends where the aligner heard it end.
  const until = (start: number, end: number) =>
    Math.min(end, ...found.filter(({ from }) => from > start && end > from).map(({ stop }) => Math.max(stop, start + 1)));
  const listedSegments = (timing.segments ?? []).map(([index, start, end, ...rest]) => [index, start, until(start, end), ...rest]);
  const added = found.flatMap(({ words }) => words.map(word => [word.index, word.start, word.end]));
  return { ...timing, segments: [...listedSegments, ...added].sort((a, b) => a[1] - b[1]) };
}

/**
 * The pass over repeated words the export left out, where the aligner went
 * back at heard word `i`: its words, where it begins, and where the word
 * before it was heard to end. Null where there is none, or it is not plain.
 */
/**
 * The two passes over the same words where the aligner went back at heard word
 * `i`, the same length each, and where the earlier one starts; null where it
 * did not go back there, or not plainly.
 */
function heardPasses(heard: RecitedWord[], i: number, quiet: [number, number][]): { passes: RecitedWord[][]; firstAt: number } | null {
  if (i === 0 || heard[i].index > heard[i - 1].index) return null;
  const again = forwardRun(heard, i);
  const firstAt = heard.slice(0, i).map(word => word.index).lastIndexOf(again[0].index);
  const before = firstAt < 0 ? [] : forwardRun(heard, firstAt);
  const span = Math.min(again.length, before.length);
  // The earlier pass runs straight up to the going-back: where the aligner has
  // it go back inside it as well, it has the words muddled (Khalid al-Jalil's
  // 2:243 lists ٱلنَّاسِ لَا يَشْكُرُونَ as words 26 and 25), and the pass is not plain.
  if (span < 2 || before.length !== i - firstAt || !silentBefore(quiet, again[0].start / 1000)) return null;
  const passes = [before.slice(0, span), again.slice(0, span)];
  // Each pass opens on a word said, not on one the aligner gave 20ms: Al-Shatri's
  // 2:99 and Ghamdi's 2:76 were a word heard once, with a sliver of it made a pass.
  return passes.some(pass => pass[0].end - pass[0].start < MIN_OPENING_WORD_MS) ? null : { passes, firstAt };
}

function passLeftOut(
  heard: RecitedWord[], i: number, published: { from: number; to: number; listed: RecitedWord[] }, quiet: [number, number][]
): { words: RecitedWord[]; from: number; stop: number } | null {
  const { listed } = published;
  const found = heardPasses(heard, i, quiet);
  if (!found) return null;
  const { passes, firstAt } = found;
  const opening = listed.filter(word => word.index === passes[1][0].index);
  if (opening.length !== 1) return null;
  const near = (pass: RecitedWord[]) => Math.abs(opening[0].start - pass[0].start);
  const second = near(passes[0]) <= near(passes[1]);
  const missing = passes[second ? 1 : 0];
  // The pass it does list must be the one the aligner heard: where the
  // export's words are off altogether, as Khalid al-Jalil's 12:57 is (its
  // word 2 runs 1005-1013s over both his repeats), it cannot say which pass
  // it left out, and a pass added made a caption of two words over the whole ayah.
  const agrees = passes[second ? 0 : 1].every(word =>
    listed.some(other => other.index === word.index && Math.abs(other.start - word.start) <= MAX_PASS_DISAGREEMENT_MS));
  const from = missing[0].start;
  const to = missing[missing.length - 1].end;
  // Said, not squeezed in: the aligner put 2:36's فِى ٱلْأَرْضِ twice into 0.7s, 20ms a word.
  // Nor in silence: Al-Tunaiji's 12:106 had one 89% inside the pause before the
  // ayah; Khalid al-Jalil's real ones are at most 63% quiet.
  const said = missing.reduce((sum, word) => sum + word.end - word.start, 0) / missing.length >= MIN_PASS_WORD_MS
    && quietWithin(quiet, from / 1000, to / 1000) <= MAX_PASS_QUIET * (to - from) / 1000;
  // Inside the ayah as published: a pass outside it is the aligner reading a
  // neighbour's words as this one's (Khalid al-Jalil's 9:81, placed over 9:82),
  // or a repeat past the listed end that a caption would put over the next ayah.
  const inside = from >= published.from - PASS_BOUND_SLACK_MS && to <= published.to + PASS_BOUND_SLACK_MS;
  if (!agrees || !said || !inside || listed.some(word => word.start >= from && word.start < to)) return null;
  const wordBefore = heard[(second ? i : firstAt) - 1];
  return { words: missing, from, stop: wordBefore ? Math.min(wordBefore.end, from) : from };
}

/** The position in `words` a cut lands on, or -1 when no boundary between those two words is near it. */
function cutPosition(words: RecitedWord[], cut: { word: number; at: number }): number {
  let best = -1;
  let bestGap = Infinity;
  let candidates = 0;
  for (let j = 1; j < words.length; j++) {
    if (words[j].index !== cut.word || words[j - 1].index !== cut.word - 1) continue;
    candidates++;
    const gap = Math.abs(words[j].start / 1000 - cut.at);
    if (gap < bestGap) {
      best = j;
      bestGap = gap;
    }
  }
  // Where the join is recited once there is nothing to tell apart, so the
  // published word may sit further from the pause: Al-Muaiqly's 66:9 lists
  // وَمَأْوَىٰهُمْ 3.1s before the pause the aligner hears ahead of it.
  return bestGap <= (candidates === 1 ? LONE_CUT_TOLERANCE_SEC : CUT_TOLERANCE_SEC) ? best : -1;
}

/** An ayah of the passage: its key, how many words it has, and their text, stop signs included. */
export interface PublishedAyah {
  verseKey: string;
  wordCount: number;
  words?: string[];
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
  /** Where a caption changes at a pause the aligner heard, by position, in ms -- see `heardAt`. */
  cutAt: Map<number, number>;
}

/**
 * A caption boundary moved to where the aligner heard the pause. The published word times inside an ayah can run a second or more
 * early -- Al-Muaiqly's 66:9 lists ٱلنَّبِىُّ at 301.8s, heard at 303.5s, and
 * وَمَأْوَىٰهُمْ 3s early; Khalid al-Jalil's 12:88 put إِنَّ ٱللَّهَ at 1586.0s, inside
 * عَلَيْنَآ, where it is heard at 1587.3s -- so a caption cut at the published
 * word changed while the words before it were still being said. Never moved
 * back past the word before's own start. Only the caption's edge moves: the
 * word keeps its own time, which `inTheGaps` reads to tell a gap before it from
 * a hum inside it.
 */
function heardAt(cutAt: Map<number, number>, words: RecitedWord[], j: number, atSec: number): void {
  const at = Math.round(atSec * 1000);
  if (at > words[j - 1].start) cutAt.set(j, at);
}

function planAyah(
  ayah: PublishedAyah, published: ReciterVerseTiming, aligned: MatchSegment[], drifts: boolean, quiet: [number, number][] = []
): AyahPlan {
  const { verseKey, wordCount, words: text = [] } = ayah;
  const offset = drifts && aligned.length ? heardOffset(aligned, verseKey, published) : 0;
  const moved = offset ? openingAsHeard(shifted(published, offset), published, aligned, verseKey) : published;
  const timing = withHeardRepeats(moved, aligned, verseKey, quiet);
  const heard = aligned.length ? alignerRestarts(aligned, verseKey) : null;
  const words = recitedWords(timing, wordCount, heard ? atMs => heard.some(at => Math.abs(at * 1000 - atMs) <= CUT_TOLERANCE_SEC * 1000) : undefined);
  const restarts = new Set<number>();
  for (let j = 1; j < words.length; j++) if (words[j].index <= words[j - 1].index) restarts.add(j);
  const pauses: number[] = [];
  // A breath with no stop sign needs the recording to show one: the aligner
  // also cuts mid-phrase with nothing heard there. What counts is the quiet
  // left once the words the aligner placed in it are taken out. Khalid
  // al-Jalil's three breaths in 12:86-88 leave 0.37-0.40s; Al-Shuraim's
  // recording dips as far on تَجِدَ itself (17:97: 1092.78-1093.22s, the word at
  // 1092.88-1093.16s), leaving 0.16s, and he did not stop there.
  const spoken = aligned.flatMap(segment => segment.wordTimings || []).filter(word => word.end - word.start > 0.05);
  const unspoken = ([from, to]: [number, number]) =>
    to - from - spoken.reduce((sum, word) => sum + Math.max(0, Math.min(to, word.end) - Math.max(from, word.start)), 0);
  const breathed = (at: number) =>
    quiet.some(gap => gap[0] - 0.3 <= at && at <= gap[1] + 0.3 && unspoken(gap) >= MIN_GAP_SEC);
  const allowed = (cut: { word: number; at: number }) =>
    stopAllowedAfter(text[cut.word - 2]) || (breathAllowedBetween(text[cut.word - 2], text[cut.word - 1]) && breathed(cut.at));
  const cutAt = new Map<number, number>();
  for (const cut of alignerCuts(aligned, verseKey).filter(allowed)) {
    const j = cutPosition(words, cut);
    if (j > 0) {
      pauses.push(j);
      heardAt(cutAt, words, j, cut.at);
    }
  }
  const starts = [0, ...[...new Set([...restarts, ...pauses])].sort((a, b) => a - b)];
  return { verseKey, wordCount, timing, words, starts, restarts, cutAt };
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
  const { verseKey, wordCount, timing, words, starts, restarts, cutAt } = plan;
  const first = starts[n];
  const next: number | undefined = starts[n + 1];
  const last = (next ?? words.length) - 1;
  const lo = n === 0 ? 1 : words[first].index;
  const hi = next === undefined ? wordCount : restarts.has(next) ? words[last].index : words[next].index - 1;
  // The ayah's own start and end, not its first and last word's: an export can
  // stretch an edge word well past them -- Ghamdi's 10:22 ends at 515.99s and
  // its last word runs to 533.63s, over 10:23; Al-Rifai's 4:12 starts at
  // 324.10s and its first word at 308.90s, inside 4:11.
  const start = n === 0 ? (timing.from < words[0].end ? timing.from : words[0].start) : cutAt.get(first) ?? words[first].start;
  const end = next === undefined ? (timing.to > start ? timing.to : words[last].end) : cutAt.get(next) ?? words[next].start;
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
  passage: PublishedAyah[],
  published: Map<string, ReciterVerseTiming>,
  aligned: MatchSegment[],
  { drifts = false, regions = [], quiet = [] }: { drifts?: boolean; regions?: MeasuredRegion[]; quiet?: [number, number][] } = {}
): MatchSegment[] | null {
  const captions: MatchSegment[] = [];
  for (const ayah of passage) {
    const { verseKey, wordCount } = ayah;
    const measured = regionCaptions(regions, verseKey);
    if (measured) {
      captions.push(...measured);
      continue;
    }
    const timing = published.get(verseKey);
    if (!timing || !(timing.to > timing.from) || wordCount < 1) return null;
    const plan = planAyah(ayah, timing, aligned, drifts, quiet);
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
  // A measured stretch interleaves its ayahs as recited.
  if (regions.length) captions.sort((a, b) => a.startTime! - b.startTime!);
  return withoutOverlaps(captions);
}

/** An ayah's captions from the measured stretch that holds it, or null when none does. */
function regionCaptions(regions: MeasuredRegion[], verseKey: string): MatchSegment[] | null {
  const ayah = Number(verseKey.split(':')[1]);
  const region = regions.find(stretch => stretch.ayahs[0] <= ayah && ayah <= stretch.ayahs[1]);
  return region ? region.segments.filter(segment => segment.verseKey === verseKey).map(segment => ({ ...segment })) : null;
}

/**
 * The captions with none starting before the one before it ends. Where two
 * ayahs' published bounds disagree, the later one's start decides -- or, where
 * that is no start at all (Ghamdi's 55:2 is listed from 0s, inside 55:1), its
 * first word's.
 */
function withoutOverlaps(captions: MatchSegment[]): MatchSegment[] {
  for (let i = 1; i < captions.length; i++) {
    const before = captions[i - 1];
    const after = captions[i];
    if (after.startTime! >= before.endTime!) continue;
    if (after.startTime! <= before.startTime!) {
      const firstWord = after.wordTimings?.[0]?.start ?? before.endTime!;
      after.startTime = Math.max(firstWord, before.startTime! + 0.1);
    }
    before.endTime = after.startTime;
  }
  return captions;
}

/**
 * Least share of the published words the aligner must have heard near their
 * published times to be listened to. Across 91 passages of every reciter
 * (2026-10-08) its sound readings scored 0.80-1.00, most above 0.93; the ones
 * it had itself lost track of (a refrain, a passage half placed) 0.15-0.62.
 */
const MIN_WORDS_AGREEING = 0.8;

/**
 * Whether the aligner heard the passage where the published timings put it:
 * most of the published words heard, at one of their readings, within
 * `MAX_OFFSET_MS` of their published start.
 *
 * This overrules the aligner's own warning. The warning compares what the
 * whole window says with the passage, and the ten seconds the studio pads
 * either side outweigh a short passage: Shuraim's 7:18-19 came in at 27%,
 * Jalil's 74:8-11 at 31%, and a quarter of a random check of every reciter
 * was left without its pauses, restarts and offset correction. For a
 * built-in reciter the published timings already say where the passage is.
 */
function agreesWithPublished(
  passage: PublishedAyah[],
  published: Map<string, ReciterVerseTiming>,
  aligned: MatchSegment[]
): boolean {
  const heard = new Map<string, number[]>();
  for (const segment of aligned) {
    for (const word of segment.wordTimings ?? []) {
      const key = `${segment.verseKey}#${word.index}`;
      heard.set(key, [...(heard.get(key) ?? []), word.start * 1000]);
    }
  }
  let words = 0;
  let agreeing = 0;
  for (const { verseKey } of passage) {
    for (const [index, start] of published.get(verseKey)?.segments ?? []) {
      words++;
      if (heard.get(`${verseKey}#${index - 1}`)?.some(at => Math.abs(at - start) <= MAX_OFFSET_MS)) agreeing++;
    }
  }
  return words > 0 && agreeing / words >= MIN_WORDS_AGREEING;
}

/**
 * The aligner's result for a timed reciter, replaced by the published timings
 * cut at the pauses it heard. A result the aligner itself doubts, unless it
 * agrees with the published timings, says nothing reliable about pauses
 * either, so then, as with no result at all, each ayah is one caption.
 */
/**
 * A gap long enough to be the voice stopping, not a consonant closing: those
 * between phrases in Khalid al-Jalil's 12:86-88 measure 0.34-0.46s, while the
 * doubled ب of Yasser's رَبُّهُمْ in 51:16 closes for 0.24s.
 */
const MIN_GAP_SEC = 0.3;
/** How far a change of caption may move to reach the gap it belongs in. */
const GAP_REACH_SEC = 1;

/**
 * Each change of caption moved into the gap where the voice stops, when one is
 * near. Word edges, published or aligned, sit up to half a second off: Khalid
 * al-Jalil's 12:87 changed captions at 1558.7s while ٱللَّهِ was still being said
 * to 1559.24s, the next caption showing before its words; the gap is
 * 1559.28-1559.74s. In the middle of the nearest gap, the old text stays until
 * he stops and the new one is up before he starts. Left where it is when no
 * gap is near.
 */
export function inTheGaps(captions: MatchSegment[], quiet: [number, number][] | undefined, aligned: MatchSegment[] = []): MatchSegment[] {
  if (!quiet?.length) return captions;
  const out = captions.map(caption => ({ ...caption }));
  // Where the aligner heard each word start, for a second witness to the word
  // times the captions carry, which can run late (Al-Sudais's 36:56).
  const heardStarts = new Map<string, number[]>();
  for (const segment of aligned) {
    for (const word of segment.wordTimings || []) {
      const key = `${segment.verseKey}:${word.index}`;
      heardStarts.set(key, [...(heardStarts.get(key) || []), word.start]);
    }
  }
  const firstHeard = (caption: MatchSegment): number | undefined => {
    const word = caption.wordTimings?.find(w => typeof w.start === 'number');
    if (!word) return undefined;
    const heard = (heardStarts.get(`${caption.verseKey}:${word.index}`) || []).filter(at => Math.abs(at - word.start) <= GAP_REACH_SEC * 2);
    return Math.min(word.start, ...heard);
  };
  for (let i = 1; i < out.length; i++) {
    const before = out[i - 1];
    const after = out[i];
    const at = after.startTime;
    if (typeof at !== 'number' || typeof before.endTime !== 'number' || Math.abs(before.endTime - at) > 0.3) continue;
    // A gap that runs on past where the next caption's first word starts is a
    // hum inside that word, not the voice stopping before it: Al-Shuraim's
    // 17:96 has one in the doubled nūn of إِنَّهُۥ.
    const resumes = (firstHeard(after) ?? at) + 0.15;
    // Nor a gap that starts before the caption's own last word is over: a
    // closure inside it (Al-Shuraim's 17:97, inside ٱلْمُهْتَدِ).
    const lastWord = before.wordTimings?.filter(word => typeof word.end === 'number').pop();
    const stopped = (lastWord ? lastWord.end : -Infinity) - 0.15;
    const near = quiet.filter(([from, to]) =>
      to - from >= MIN_GAP_SEC && from <= at + GAP_REACH_SEC && to >= at - GAP_REACH_SEC && to <= resumes && from >= stopped);
    if (!near.length) continue;
    // The nearest: the change is already roughly placed, and a closure inside
    // a word nearby can be as long as the gap (12:88: 1586.90-1587.30s before
    // إِنَّ, 1587.78-1588.18s inside ٱللَّهَ). The longer of two as near.
    const away = ([from, to]: [number, number]) => Math.max(0, from - at, at - to);
    const [from, to] = near.reduce((a, b) => (away(b) < away(a) - 1e-6 || (Math.abs(away(b) - away(a)) <= 1e-6 && b[1] - b[0] > a[1] - a[0]) ? b : a));
    const middle = Math.round(((from + to) / 2) * 100) / 100;
    if (middle <= (before.startTime ?? 0) + 0.3 || middle >= (after.endTime ?? Infinity) - 0.3) continue;
    before.endTime = middle;
    after.startTime = middle;
  }
  return out;
}

export function timedFromPublished(
  published: {
    provider: string; passage: PublishedAyah[]; timings: Map<string, ReciterVerseTiming>; drifts?: boolean; regions?: MeasuredRegion[];
  },
  everything: MatchResult
): { result: MatchResult; pausesFromAudio: boolean } {
  const aligned = passageOnly(everything, published.passage);
  const heard = aligned.segments.length > 0 &&
    (!aligned.warning || agreesWithPublished(published.passage, published.timings, aligned.segments));
  const captions = phrasesFromPublished(
    published.passage, published.timings, heard ? aligned.segments : [],
    { drifts: published.drifts, regions: published.regions, quiet: everything.quiet }
  );
  if (!captions) return { result: aligned, pausesFromAudio: false };
  return {
    pausesFromAudio: heard,
    result: {
      audioDuration: aligned.audioDuration,
      confidence: 1,
      segments: inTheGaps(captions, everything.quiet, aligned.segments),
      // What was said before the passage is the aligner's to hear: the
      // published timings start at the first ayah, and dropping these lost
      // every timed reciter's isti'adha and basmala.
      openings: aligned.openings,
      notes: `Timed from ${published.provider}'s published word timings, ` +
        (heard ? 'cut where the aligner heard the reciter pause.' : 'one caption per ayah.')
    }
  };
}

/**
 * An alignment cut down to the passage's ayahs. The aligner is also given the
 * ayahs either side whose audio is in its window (see `publishedPassage`), and
 * an isti'adha or basmala it heard before one of the ayahs before is that
 * ayah's, not the passage's. Unchanged when it holds nothing else.
 */
function passageOnly(aligned: MatchResult, passage: PublishedAyah[]): MatchResult {
  const ayahOf = (verseKey: string | undefined) => Number(verseKey?.split(':')[1]);
  const first = ayahOf(passage[0]?.verseKey);
  const last = ayahOf(passage[passage.length - 1]?.verseKey);
  const segments = aligned.segments.filter(segment => !(ayahOf(segment.verseKey) < first || ayahOf(segment.verseKey) > last));
  const before = aligned.segments.some(segment => ayahOf(segment.verseKey) < first);
  if (segments.length === aligned.segments.length && !before) return aligned;
  return { ...aligned, segments, openings: before ? undefined : aligned.openings };
}

/**
 * Whether a passage's published timings can be believed: every ayah at least
 * 0.3s long, each starting no earlier than a second before the one before it
 * ends, and most of its words inside its own bounds.
 *
 * Read across every built-in reciter's 114 surahs (2026-10-08), a handful of
 * ayahs are past saving -- Al-Rifai's 8:61 listed as 0.02s long with its words
 * spread over 8:62, Abdul Basit's 55:70 starting a minute after 55:71 -- and
 * timed from them the captions are simply wrong. Such a passage is timed by
 * the aligner instead, from the recording itself.
 */
export function soundTimings(passage: { timing: ReciterVerseTiming | null; wordCount: number }[]): boolean {
  let previousTo = -Infinity;
  for (const { timing, wordCount } of passage) {
    if (!timing || timing.to - timing.from < 300 || timing.from < previousTo - 1000) return false;
    const words = (timing.segments || []).filter(([, start]) => start >= timing.from - 1000 && start <= timing.to + 1000);
    if ((timing.segments?.length ?? 0) > 0 && words.length < Math.min(wordCount, timing.segments!.length) / 2) return false;
    previousTo = timing.to;
  }
  return true;
}

/**
 * Each ayah's start and end as its captions will have them, in seconds, for a
 * load to show before any matching: the same repairs -- smeared edges, scrambled
 * restarts, overlaps -- applied to the published bounds rather than the raw
 * ones. Null when the timings are past believing (`soundTimings`).
 */
export function publishedAyahBounds(
  passage: PublishedAyah[],
  published: Map<string, ReciterVerseTiming>,
  regions: MeasuredRegion[] = []
): Map<string, { start: number; end: number }> | null {
  if (!soundTimings(passage.map(ayah => ({ timing: published.get(ayah.verseKey) ?? null, wordCount: ayah.wordCount })))) return null;
  const captions = phrasesFromPublished(passage, published, [], { regions });
  if (!captions) return null;
  const bounds = new Map<string, { start: number; end: number }>();
  for (const caption of captions) {
    const key = caption.verseKey!;
    const held = bounds.get(key);
    bounds.set(key, held
      ? { start: Math.min(held.start, caption.startTime!), end: Math.max(held.end, caption.endTime!) }
      : { start: caption.startTime!, end: caption.endTime! });
  }
  // An ayah of a measured stretch read twice spans the ayahs between its two
  // readings; a load shows it up to where the next ayah first starts.
  if (regions.length) clampToNext(bounds, passage.map(ayah => ayah.verseKey));
  return bounds;
}

/** Each span ended no later than the next ayah's start. */
function clampToNext(bounds: Map<string, { start: number; end: number }>, verseKeys: string[]): void {
  for (let i = 0; i + 1 < verseKeys.length; i++) {
    const span = bounds.get(verseKeys[i]);
    const next = bounds.get(verseKeys[i + 1]);
    if (span && next && next.start > span.start && next.start < span.end) span.end = next.start;
  }
}
