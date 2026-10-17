/**
 * A timed reciter's passage as captions: the published word timings, split
 * where the reciter pauses.
 *
 * For a reciter with published timings the aligner is the less reliable of the
 * two sources. The Quran Foundation timed every word of each ayah's own file;
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
  /** A pass the published words left out, added from what the aligner heard (`withHeardRepeats`). */
  heard?: boolean;
}

/** The marker `withHeardRepeats` puts after an added word's times, for `recitedWords` to keep it. */
const HEARD_PASS = 1;

/**
 * The ayah's words in the order they were recited, repeats included.
 *
 * A repeat can be any length, a single word included: a reciter does go back
 * over one word (Al-Shatri's 10:12 فَلَمَّا ... فَلَمَّا). Never require more --
 * the owner's rule, 2026-10-15, after a two-word minimum lost that one. A word
 * listed twice in a row is that repeat wherever the aligner heard the reciter
 * go back there; without that it is one word, since published timings also cut
 * a long madd into pieces (QUL's Al-Muaiqly export did so 132 times).
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
    .map(([index, start, end, mark]) => ({ index, start, end, heard: mark === HEARD_PASS }))
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
    // Said again where the aligner heard it go back, or added from what it heard: a repeat, not a madd cut in two.
    const repeated = word.heard || Boolean(heardRestart?.(word.start));
    if (previous?.index === word.index && !repeated) previous.end = Math.max(previous.end, word.end);
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
    const sound = !block.length || (heardRestart && !heardRestart(block[0].start)) ? null : soundBlock(block, reached, Boolean(heardRestart));
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
function soundBlock(block: RecitedWord[], reached: number, heardGoingBack: boolean): RecitedWord[] | null {
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
  if (once && indices.length >= 2 && indices[indices.length - 1] === reached) return block.map((word, k) => ({ ...word, index: indices[k] }));
  // Shorter still -- one word said again -- where the aligner heard the
  // reciter go back, or the words are its own reading: a repeat of any length.
  return heardGoingBack || block.every(word => word.heard) ? block : null;
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
 * Only where it is plain: a pass of any length, one word included (Al-Shatri's
 * 10:12 فَلَمَّا), the reciter silent for `MIN_GAP_SEC` just before
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
  const added = found.flatMap(({ words }) => words.map(word => [word.index, word.start, word.end, HEARD_PASS]));
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
  // A pass of any length, one word included (see `recitedWords`).
  if (span < 1 || before.length !== i - firstAt || !silentBefore(quiet, again[0].start / 1000)) return null;
  const passes = [before.slice(0, span), again.slice(0, span)];
  // Said again after it was said: a second reading that starts before the
  // first has ended is one word the aligner split in two -- Abdul Basit's
  // Mujawwad 67:2 «أَحْسَنُ», sung long, read as 34.17-34.70s and 34.49-35.42s.
  if (passes[1][0].start < passes[0][passes[0].length - 1].end) return null;
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
  // No published word starts inside it -- up to where its last word starts:
  // Al-Sudais's 39:55 lists وَأَنتُمْ at 49.90s, his repeat ending 49.91s.
  const lastStart = missing[missing.length - 1].start;
  if (!agrees || !said || !inside || listed.some(word => word.start >= from && word.start < lastStart)) return null;
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

/** What the recording says about pauses besides the aligner's cuts: see `phrasesFromPublished`. */
interface Heard {
  quiet?: [number, number][];
  silences?: [number, number][];
  sung?: boolean;
}

/** The longest stretch of `silences` inside `from`-`to`, in seconds. */
function longestWithin(silences: [number, number][], from: number, to: number): number {
  return silences.reduce((most, [a, b]) => Math.max(most, Math.min(b, to) - Math.max(a, from)), 0);
}

/**
 * Where the aligner did not cut at a stop sign, a cut at it anyway, for the
 * phoneme model's silence to decide: it reads one run of words where the
 * reciter stopped as readily as anywhere. Al-Sudais's 2:255 «بِإِذْنِهِۦ ۚ» is
 * one; at the place in the recording it heard the word after start.
 */
function uncutStops(aligned: MatchSegment[], verseKey: string, text: string[], cut: Set<number>): { word: number; at: number }[] {
  const heard = heardWords(aligned, verseKey);
  const stops: { word: number; at: number }[] = [];
  for (let j = 1; j < heard.length; j++) {
    const word = heard[j].index;
    if (heard[j - 1].index !== word - 1 || cut.has(word) || !stopAllowedAfter(text[word - 2])) continue;
    stops.push({ word, at: heard[j].start / 1000 });
  }
  return stops;
}

/** How much later than published a word must be heard to start where it was heard: see `withHeardStarts`. */
const MIN_LATE_START_MS = 500;

/**
 * The ayahs that open on letters said by name (الٓمٓ, يسٓ, حمٓ, عٓسٓقٓ, صٓ, قٓ, نٓ...).
 * The aligner reads them as the last letter it can match -- Al-Muaiqly's 2:1
 * heard at «مٓ», six seconds into «الٓمٓ» -- so their first word keeps its
 * published start. The same list is in scripts/qf-chapter-plan.mjs.
 */
const SEPARATE_LETTERS = new Set([
  '2:1', '3:1', '7:1', '10:1', '11:1', '12:1', '13:1', '14:1', '15:1', '19:1', '20:1', '26:1', '27:1', '28:1', '29:1',
  '30:1', '31:1', '32:1', '36:1', '38:1', '40:1', '41:1', '42:1', '42:2', '43:1', '44:1', '45:1', '46:1', '50:1', '68:1',
]);

/**
 * The published timing with each word that was plainly heard later than
 * listed starting where it was heard, so the word lit up is the one being
 * said. Some of the Quran Foundation's word times run early: Al-Minshawi's
 * Mujawwad 32:17 lists مَّآ for 10ms at 35.57s, أُخْفِىَ straight after it and
 * لَهُم over the next 7.2s, where he says them at 38.3s, 41.3s and 43.1s, and
 * 32:18's كَانَ 1.7s early. Measured on 882 words of every reciter
 * (2026-10-15), the published start was 0.5s or more early 63 times, Mujawwad
 * mostly, and never 0.5s late; the aligner reads a word 0.2s late at the
 * median, so less than `MIN_LATE_START_MS` is left as published.
 *
 * Only for an ayah read plainly: every word listed once and heard once, in
 * order. A repeat or a word the aligner lost leaves nothing to pair words by.
 */
function withHeardStarts(timing: ReciterVerseTiming, aligned: MatchSegment[], verseKey: string): ReciterVerseTiming {
  const segments = [...(timing.segments ?? [])].sort((a, b) => a[1] - b[1]);
  const heard = heardWords(aligned, verseKey);
  const plain = (indices: number[]) => indices.length > 0 && indices.every((index, i) => index === i + 1);
  if (!plain(segments.map(([index]) => index)) || heard.length !== segments.length || !plain(heard.map(word => word.index))) return timing;
  const lettersFirst = SEPARATE_LETTERS.has(verseKey);
  const moved = segments.map(([index, start, end, ...rest], i) =>
    heard[i].start - start >= MIN_LATE_START_MS && !(lettersFirst && i === 0)
      ? [index, heard[i].start, Math.max(end, heard[i].end), ...rest] : [index, start, end, ...rest]);
  // Nor starts before the word before it: one heard only a little late
  // follows a word before it that moved past its listed start.
  for (let i = 1; i < moved.length; i++) if (moved[i][1] <= moved[i - 1][1]) moved[i] = [moved[i][0], heard[i].start, Math.max(moved[i][2], heard[i].end), ...moved[i].slice(3)];
  // No word runs past the start of the next.
  for (let i = 0; i + 1 < moved.length; i++) moved[i][2] = Math.min(moved[i][2], moved[i + 1][1]);
  return { ...timing, segments: moved };
}

/** A place a caption may start: the word there, 1-based, and when, in seconds. */
type Cut = { word: number; at: number };

/** What the recording says about the join at a cut: see `stopsHeard`. */
function joinEvidence(aligned: MatchSegment[], verseKey: string, quiet: [number, number][], silences: [number, number][]) {
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
  // This ayah's words only: another ayah's same-numbered word is no edge of
  // this join (39:55's word 12, 20s on, was taken for 39:53's).
  const ownSpoken = aligned.filter(segment => segment.verseKey === verseKey)
    .flatMap(segment => segment.wordTimings || []).filter(word => word.end - word.start > 0.05);
  const around = (cut: Cut) => ({
    before: ownSpoken.filter(word => word.index === cut.word - 2 && word.end <= cut.at + 0.5).at(-1),
    after: ownSpoken.find(word => word.index === cut.word - 1 && word.start >= cut.at - 0.5)
  });
  const wordGap = (cut: Cut) => {
    const { before, after } = around(cut);
    return before && after ? after.start - before.end : 0;
  };
  // The phoneme model hearing nothing said, between the two words' edges as
  // the aligner heard them, which may be a little off either way.
  const join = (cut: Cut): [number, number] => {
    const { before, after } = around(cut);
    return [(before?.end ?? cut.at - 0.3) - SILENCE_REACH_SEC, (after?.start ?? cut.at + 0.3) + SILENCE_REACH_SEC];
  };
  const unsaid = (cut: Cut) => longestWithin(silences, ...join(cut));
  // Murattal, the phoneme model's silence is a stop only where the level
  // dropped too: it also hears nothing in a vowel held steady, as Al-Tablawi
  // held 21:90's «وَرَهَبًا ۖ» into وَكَانُوا۟ -- 0.76s of it, no quiet at all --
  // where every stop the owner kept has 0.26s of quiet or more.
  const silentStop = (cut: Cut) => unsaid(cut) >= MIN_STOP_SILENCE_SEC && quietWithin(quiet, ...join(cut)) >= MIN_STOP_QUIET_SEC;
  return { breathed, wordGap, unsaid, silentStop };
}

/** Where in `verseKey` the reciter stopped: the aligner's cuts the recording bears out, and stop signs it did not cut at. */
function stopsHeard(aligned: MatchSegment[], verseKey: string, text: string[], { quiet = [], silences = [], sung = false }: Heard): Cut[] {
  const { breathed, wordGap, unsaid, silentStop } = joinEvidence(aligned, verseKey, quiet, silences);
  // A stop sign allows a stop; it is taken only where the reciter made one:
  // the real quiet a breath needs, or -- where the level never drops enough
  // to measure, as in Al-Minshawi's echoing Mujawwad (32:23, 1.1s between the
  // words and no quiet measured) -- `MIN_STOP_WORD_GAP_SEC` between the
  // words. Al-Tablawi's 32:14 «نَسِينَـٰكُمْ ۖ» runs on with 0.25s of quiet
  // and 0.5s between the words, where his other stops in 32:13-25 leave 0.96s
  // or more, and was split for nothing. With no quiet measured at all (an
  // older sidecar), a stop sign is taken on the aligner's word as before;
  // or the phoneme model hearing nothing said for `MIN_STOP_SILENCE_SEC`.
  const stopped = (cut: Cut) =>
    breathed(cut.at) || wordGap(cut) >= MIN_STOP_WORD_GAP_SEC || !quiet.length
    || (silences.length > 0 && silentStop(cut));
  // Sung, a held note leaves room as long as a murattal stop on any join; only
  // a stop far longer than any held note is one.
  const allowed = sung && silences.length
    ? (cut: Cut) =>
      (stopAllowedAfter(text[cut.word - 2]) || breathAllowedBetween(text[cut.word - 2], text[cut.word - 1]))
        && unsaid(cut) >= MIN_SUNG_STOP_SILENCE_SEC
    : (cut: Cut) =>
      stopAllowedAfter(text[cut.word - 2]) ? stopped(cut)
        : breathAllowedBetween(text[cut.word - 2], text[cut.word - 1]) && breathed(cut.at);
  const cuts = alignerCuts(aligned, verseKey).filter(allowed);
  // Where the aligner did not cut, only the phoneme model's silence says the
  // reciter stopped: the aligner's word edges there are no stop's -- Al-Sudais
  // went back over 39:53's «لَا تَقْنَطُوا۟ مِن رَّحْمَةِ ٱللَّهِ ۚ» and ran on into
  // إِنَّ with its words 0.85s apart, and ran 2:257's «ٱلنَّارِ ۖ» into هُمْ
  // through 0.47s of quiet.
  if (silences.length) {
    const heardStop = sung ? (cut: Cut) => unsaid(cut) >= MIN_SUNG_STOP_SILENCE_SEC : silentStop;
    cuts.push(...uncutStops(aligned, verseKey, text, new Set(cuts.map(cut => cut.word))).filter(heardStop));
  }
  return cuts;
}

function planAyah(ayah: PublishedAyah, published: ReciterVerseTiming, aligned: MatchSegment[], recording: Heard = {}): AyahPlan {
  const { verseKey, wordCount, words: text = [] } = ayah;
  const timing = withHeardStarts(withHeardRepeats(published, aligned, verseKey, recording.quiet ?? []), aligned, verseKey);
  const heard = aligned.length ? alignerRestarts(aligned, verseKey) : null;
  const words = recitedWords(timing, wordCount, heard ? atMs => heard.some(at => Math.abs(at * 1000 - atMs) <= CUT_TOLERANCE_SEC * 1000) : undefined);
  const restarts = new Set<number>();
  for (let j = 1; j < words.length; j++) if (words[j].index <= words[j - 1].index) restarts.add(j);
  const pauses: number[] = [];
  const cutAt = new Map<number, number>();
  for (const cut of stopsHeard(aligned, verseKey, text, recording)) {
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
  heard: Heard = {}
): MatchSegment[] | null {
  const captions: MatchSegment[] = [];
  for (const ayah of passage) {
    const { verseKey, wordCount } = ayah;
    const timing = published.get(verseKey);
    if (!timing || !(timing.to > timing.from) || wordCount < 1) return null;
    const plan = planAyah(ayah, timing, aligned, heard);
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
  return withoutOverlaps(captions);
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
/** How far from its published start a heard word may be and still agree: further is another word. */
const MAX_WORD_DISAGREEMENT_MS = 2500;

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
      if (heard.get(`${verseKey}#${index - 1}`)?.some(at => Math.abs(at - start) <= MAX_WORD_DISAGREEMENT_MS)) agreeing++;
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
/**
 * Silence between two words, by the aligner's reading, that is a stop however
 * little of it the level meter measured. Al-Tablawi ran on through 0.5s at
 * 32:14; his stops, Al-Sudais's 2:257 and Al-Minshawi's are 0.8s or more.
 */
const MIN_STOP_WORD_GAP_SEC = 0.6;
/**
 * The phoneme model hearing nothing said for this long, at a stop sign, is a
 * stop however the level meter read it -- a soft held madd it writes as its
 * vowel, so loudness and echo do not fool it. On the owner's ground truth for
 * the Quran Foundation's murattal recordings (2026-10-15), his stops measure
 * 0.68s and more (Al-Tablawi's 32:23 «لِّقَآئِهِۦ ۖ»), his run-ons at most
 * 0.20s (Al-Tablawi's 32:14 «نَسِينَـٰكُمْ ۖ»).
 */
const MIN_STOP_SILENCE_SEC = 0.4;
/** Measured quiet a murattal stop on the phoneme model's silence needs as well: see `joinEvidence`. */
const MIN_STOP_QUIET_SEC = 0.2;
/**
 * The same, sung (Mujawwad): the reciter holds a note and lets it ring for
 * a second or two inside a phrase -- Al-Minshawi's 32:20 measures 2.4s after
 * كُلَّمَآ, Abdul Basit's 67:3 1.1s after «طِبَاقًا ۖ», neither a stop -- and his
 * stops run longer still (67:3 «تَفَـٰوُتٍ ۖ» 3.8s, 32:20 «ٱلنَّارُ ۖ» 4.0s).
 */
const MIN_SUNG_STOP_SILENCE_SEC = 2.5;
/** How far past the words' edges, as the aligner heard them, a silence is looked for. */
const SILENCE_REACH_SEC = 0.2;
/** How far a change of caption may move to reach the gap it belongs in. */
const GAP_REACH_SEC = 1;
/** How long before the voice resumes the next caption comes up. */
const CHANGE_LEAD_SEC = 0.1;
/**
 * A gap this long is the reciter stopping, whatever the words placed in it say:
 * no hum or closure inside a word lasts a second. The aligner put Al-Muaiqly's
 * 32:18 «لَّا» at the start of his 1.9 s pause after «فَاسِقًا ۚ», 2.3 s before
 * he says it.
 */
const SURE_GAP_SEC = 1;

/**
 * Each change of caption moved into the gap where the voice stops, when one is
 * near. Word edges, published or aligned, sit up to half a second off: Khalid
 * al-Jalil's 12:87 changed captions at 1558.7s while ٱللَّهِ was still being said
 * to 1559.24s, the next caption showing before its words; the gap is
 * 1559.28-1559.74s. At the end of the nearest gap, just before he starts
 * again: the old text stays through the pause and the new one comes up with
 * its first word (the owner's choice, 2026-10-17: a change in the middle of a
 * long pause showed the next ayah a second before it was said). Left where it
 * is when no gap is near.
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
      to - from >= MIN_GAP_SEC && from <= at + GAP_REACH_SEC && to >= at - GAP_REACH_SEC &&
      (to <= resumes || to - from >= SURE_GAP_SEC) && from >= stopped);
    if (!near.length) continue;
    // The nearest: the change is already roughly placed, and a closure inside
    // a word nearby can be as long as the gap (12:88: 1586.90-1587.30s before
    // إِنَّ, 1587.78-1588.18s inside ٱللَّهَ). The longer of two as near.
    const away = ([from, to]: [number, number]) => Math.max(0, from - at, at - to);
    const [from, to] = near.reduce((a, b) => (away(b) < away(a) - 1e-6 || (Math.abs(away(b) - away(a)) <= 1e-6 && b[1] - b[0] > a[1] - a[0]) ? b : a));
    const change = Math.round(Math.max((from + to) / 2, to - CHANGE_LEAD_SEC) * 100) / 100;
    if (change <= (before.startTime ?? 0) + 0.3 || change >= (after.endTime ?? Infinity) - 0.3) continue;
    before.endTime = change;
    after.startTime = change;
  }
  return out;
}

/** Recording kept before the passage's first word and after the reciter stops: see `toTheVoice`. */
const EDGE_LEAD_SEC = 0.4;
const EDGE_TAIL_SEC = 1;

/**
 * The passage's first caption started where the voice does, and its last
 * ended where it stops, a breath either side. Each ayah's file carries the
 * reciter's silence at both ends -- Al-Minshawi's Mujawwad 32:16 starts 1.7s
 * in, 32:18 rings out 85.3-90.8s and then is silent to 92.6s -- and a clip cut
 * at the files' edges opened and closed on it. The first word's published
 * start is never late (see `withHeardStarts`), so it bounds the start; the
 * last word's published end can be, a held madd sung on past it, so the end
 * is where the quiet that runs to the end of the file begins. Left as it is
 * where no such quiet was measured.
 */
export function toTheVoice(captions: MatchSegment[], quiet: [number, number][] | undefined): MatchSegment[] {
  if (!captions.length) return captions;
  const out = captions.map(caption => ({ ...caption }));
  const first = out[0];
  const said = first.wordTimings?.[0]?.start;
  if (typeof said === 'number' && typeof first.startTime === 'number' && said - EDGE_LEAD_SEC > first.startTime) {
    first.startTime = Math.round((said - EDGE_LEAD_SEC) * 1000) / 1000;
  }
  const last = out[out.length - 1];
  const lastWord = last.wordTimings?.at(-1);
  const end = last.endTime;
  if (!lastWord || typeof end !== 'number') return out;
  const after = (quiet ?? []).find(([from, to]) => to >= end - 0.1 && from <= end && from >= lastWord.start);
  if (after && after[0] + EDGE_TAIL_SEC < end) last.endTime = Math.round((after[0] + EDGE_TAIL_SEC) * 1000) / 1000;
  return out;
}

export function timedFromPublished(
  published: {
    provider: string; passage: PublishedAyah[]; timings: Map<string, ReciterVerseTiming>;
    /** Sung (Mujawwad), whose held notes leave long silences inside a phrase. */
    sung?: boolean;
  },
  everything: MatchResult
): { result: MatchResult; pausesFromAudio: boolean } {
  const aligned = passageOnly(everything, published.passage);
  const heard = aligned.segments.length > 0 &&
    (!aligned.warning || agreesWithPublished(published.passage, published.timings, aligned.segments));
  const captions = phrasesFromPublished(
    published.passage, published.timings, heard ? aligned.segments : [],
    { quiet: everything.quiet, silences: everything.silences, sung: published.sung }
  );
  if (!captions) return { result: aligned, pausesFromAudio: false };
  return {
    pausesFromAudio: heard,
    result: {
      audioDuration: aligned.audioDuration,
      confidence: 1,
      segments: toTheVoice(inTheGaps(captions, everything.quiet, aligned.segments), everything.quiet),
      // What was said before the passage is the aligner's to hear: the
      // published timings start at the first ayah, and dropping these lost
      // every timed reciter's isti'adha and basmala.
      openings: aligned.openings,
      notes: `Timed from ${published.provider === 'cut' ? 'the word timings found when the recording was cut' : `${published.provider}'s published word timings`}, ` +
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
