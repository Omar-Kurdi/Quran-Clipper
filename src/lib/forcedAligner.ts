/**
 * Forced-alignment matcher.
 *
 * `geminiMatcher.ts` asks a model *what* was recited and *when* at the same
 * time, then repairs the answer by searching the Quran text. This one inverts
 * that: the ayah range is known up front, so the Quran text becomes a fixed
 * constraint and the sidecar decides only when each word was spoken.
 *
 * What that buys, structurally rather than by tuning:
 *  - no word can go missing (every reference word is in the target sequence);
 *  - no word can be garbled (the output tokens *are* the Quran text);
 *  - nothing can land in the wrong surah (there is no corpus search at all).
 *
 * The cost is that the range has to come from somewhere: the sidecar's own
 * detection, or failing that the UI's selection. See docs/ALIGNMENT.md.
 */

import { getRange } from '@/lib/quranCorpus';
import type { MatchResult, MatchSegment } from '@/lib/matchTypes';

type AlignedWord = {
  text: string;
  verse_key: string;
  word_index: number;
  start: number;
  end: number;
  score: number;
  is_repeat: boolean;
};

type AlignResponse = {
  success: boolean;
  model: string;
  audioDuration: number;
  words: AlignedWord[];
  /**
   * Segments are computed sidecar-side now: phrase boundaries come from the
   * audio's own energy dips, and each phrase's word range from decoding it.
   * Consecutive segments may overlap in word range -- that is a reciter
   * restarting an earlier phrase and carrying further, not a bug.
   */
  segments: {
    verse_key: string;
    start_word: number;
    end_word: number;
    start: number;
    end: number;
    score: number;
    is_restart: boolean;
    /** Why a person should check this caption; see `captionChecks`. Absent from older sidecars. */
    checks?: string[];
  }[];
  meanScore: number;
  /**
   * Fraction of the supplied reference text that was given any time at all.
   * A completeness check on the sidecar, not evidence about the passage: one
   * global forced alignment places every reference word by construction, so
   * this reads 1 for a wrong ayah range as readily as for the right one.
   */
  referenceCoverage?: number;
  /**
   * How far what the recogniser heard and what the aligner placed there agree.
   * This -- not `meanScore`, and no longer `referenceCoverage` -- is what
   * distinguishes a correct ayah range from a wrong one, because it is an
   * independent reading rather than a property of the alignment being checked.
   * Roughly 0.9 when the text matches the audio and below 0.15 when it does
   * not; `null` when there was nothing to compare. See the sidecar's
   * `align.decode_agreement`.
   */
  decodeAgreement?: number | null;
  /** Present when no reference was supplied and the passage was found from the audio. */
  detectedRange: {
    /** Every passage found. A recitation is often Al-Fatihah plus a surah. */
    ranges: { surah: number; start_ayah: number; end_ayah: number; phrases: number }[];
    /** The largest passage, for a single-range label. */
    surah: number;
    start_ayah: number;
    end_ayah: number;
    confidence: number;
    matched_phrases: number;
    total_phrases: number;
  } | null;
  /** Set when the alignment fit the text but the acoustics don't support it. */
  warning: string | null;
  /** `qul` when detection ran with QUL's text data; absent on the default path. */
  assist?: AlignAssist | null;
  /** Asks the sidecar to cut this same alignment again at another setting; see `runRegroup`. */
  regroupId?: string;
};

/**
 * Where the audio to align comes from.
 *
 * A file for an upload; a URL and a window for one of the built-in reciters,
 * whose recording is the whole chapter. Sending the chapter would mean moving
 * up to 87 MB twice across the network to use thirty seconds of it, so the
 * sidecar range-seeks the window instead and reports times against the whole
 * recording, which is the file the player has loaded.
 */
export type AlignSource =
  | { kind: 'file'; audio: File }
  | { kind: 'url'; audioUrl: string; windowStart: number; windowEnd: number };

type AlignRequest = {
  serviceUrl: string;
  source: AlignSource;
  reference: string;
  assist?: AlignAssist;
  breaks?: ScreenBreaks;
};

/** The sidecar's `/align` form for one request. */
function alignmentForm(params: AlignRequest): FormData {
  const formData = new FormData();
  if (params.source.kind === 'file') {
    formData.append('audio', params.source.audio);
  } else {
    formData.append('audio_url', params.source.audioUrl);
    formData.append('window_start', String(params.source.windowStart));
    formData.append('window_end', String(params.source.windowEnd));
  }
  formData.append('reference', params.reference);
  if (params.assist) formData.append('assist', params.assist);
  if (params.breaks && params.breaks !== 'normal') formData.append('breaks', params.breaks);
  return formData;
}

async function requestAlignment(params: AlignRequest): Promise<AlignResponse> {
  return askSidecar(params.serviceUrl, '/align', alignmentForm(params));
}

/** Call the sidecar -- POSTing `formData` when there is one -- turning its error bodies into an `AlignRequestError`. */
async function askSidecar(serviceUrl: string, path: string, formData?: FormData): Promise<AlignResponse> {
  const base = serviceUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, formData ? { method: 'POST', body: formData } : undefined);
  } catch {
    throw new Error(`Could not reach the alignment service at ${base}. Is it running? See asr-service/README.md.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // FastAPI wraps errors as {detail: ...}, where detail is either a plain
    // string or a {code, message} object for cases the caller can act on.
    let message = body;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body);
      const detail = parsed?.detail;
      if (detail && typeof detail === 'object') {
        code = detail.code;
        message = detail.message ?? body;
      } else if (typeof detail === 'string') {
        message = detail;
      }
    } catch {
      // Not JSON -- keep the raw body as the message.
    }
    throw new AlignRequestError(
      `Alignment failed (${res.status}): ${message.slice(0, 400) || res.statusText}`,
      code
    );
  }
  return res.json();
}

/** Carries the sidecar's machine-readable error code, when it sent one. */
export class AlignRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'AlignRequestError';
  }
}

/**
 * One whitespace-free token per word, for the reference the sidecar aligns to.
 *
 * The sidecar re-splits the reference on whitespace and spends one word index
 * per token that survives normalisation (`main.py`), while the indices it
 * returns are read against the app's own `words` array. A word written with an
 * internal space therefore has to be closed up before it is sent, or it buys
 * two indices and every word after it in that verse is captioned one place
 * late. Four verses are written that way: بَعْدَ مَا in 2:181, 8:6 and 13:37,
 * and إِلْ يَاسِينَ in 37:130, which the word list has always sent with its
 * space in it.
 *
 * Closing the space up costs nothing -- normalisation drops everything that is
 * not a letter anyway, so the target the model aligns to is the same either
 * way -- and one token per app word makes the two counts equal by construction
 * rather than by luck. The display text keeps its spaces; only this does not.
 */
export function referenceToken(word: { arabic: string }): string {
  return word.arabic.replace(/\s+/g, '');
}

/** A detection assist the sidecar can be asked for. */
export type AlignAssist = 'qul';

/**
 * The studio's "fewer / more screen breaks" setting. It moves how much silence
 * the sidecar needs before it calls a pause a stop and ends a caption there;
 * ayah ends and restarts still break either way. See `align.BREAK_SCALES`.
 */
export type ScreenBreaks = 'fewer' | 'normal' | 'more';

/** Reads the setting off a request, where anything unrecognised is `normal`. */
export function screenBreaksFrom(value: unknown): ScreenBreaks {
  return value === 'fewer' || value === 'more' ? value : 'normal';
}

export async function runForcedAlignMatch(params: {
  serviceUrl: string;
  source: AlignSource;
  /** Omit (or pass autoDetect) to have the sidecar work the passage out from the audio. */
  surah?: number;
  start?: number;
  end?: number;
  autoDetect?: boolean;
  /**
   * `qul` has the sidecar's range detection consult QUL's morphology and
   * mutashabihat -- the studio's "Local + QUL" option. Only detection reads
   * it, so it makes no difference when a range is given.
   */
  assist?: AlignAssist;
  breaks?: ScreenBreaks;
}): Promise<MatchResult> {
  const autoDetect = params.autoDetect || !params.surah || !params.start || !params.end;
  /** Set when auto-detect was asked for but the sidecar couldn't do it. */
  let fellBackToSelected = false;

  // Auto-detect sends no reference at all: the sidecar decodes the audio,
  // finds the passage in the full Quran, and aligns against exactly that.
  // The range must be tight -- forced alignment has to place every reference
  // word, so padding it with extra ayahs would corrupt the alignment rather
  // than make it safer.
  let reference = '';
  if (!autoDetect) {
    const rangesToAlign = [{ surah: params.surah!, start: params.start!, end: params.end! }];
    const versesPerRange = await Promise.all(rangesToAlign.map(r => getRange(r.surah, r.start, r.end)));
    const missing = rangesToAlign.filter((_, i) => !versesPerRange[i].length);
    if (missing.length) {
      throw new Error(`No Quran text found for ${missing.map(r => `${r.surah}:${r.start}-${r.end}`).join(', ')}.`);
    }
    reference = versesPerRange
      .flat()
      .map(verse => `${verse.verseKey}\t${verse.words.map(referenceToken).join(' ')}`)
      .join('\n');
  }

  let result: AlignResponse;
  try {
    result = await requestAlignment({
      serviceUrl: params.serviceUrl,
      source: params.source,
      reference,
      assist: params.assist,
      breaks: params.breaks
    });
  } catch (err) {
    // Retry with the user's range only when the sidecar said auto-detection is
    // *unsupported here* -- that is the one failure a reference actually fixes.
    //
    // Any other failure (most often the backend not loading at all) fails the
    // same way with a reference attached, so retrying just doubles the wait and
    // logs a second 400 for the same underlying problem. That is exactly what
    // it did: two 400s per upload, both the same protobuf error.
    const retryable =
      err instanceof AlignRequestError &&
      err.code === 'auto_detect_unsupported' &&
      autoDetect &&
      params.surah &&
      params.start &&
      params.end;
    if (!retryable) throw err;

    console.warn(
      `[forcedAligner] auto-detect failed (${(err as Error).message.slice(0, 160)}); ` +
        `retrying with the selected range ${params.surah}:${params.start}-${params.end}.`
    );
    const selected = await getRange(params.surah!, params.start!, params.end!);
    if (!selected.length) throw err;
    result = await requestAlignment({
      serviceUrl: params.serviceUrl,
      source: params.source,
      reference: selected
        .map(verse => `${verse.verseKey}\t${verse.words.map(referenceToken).join(' ')}`)
        .join('\n'),
      assist: params.assist,
      breaks: params.breaks
    });
    fellBackToSelected = true;
  }

  return matchFromAlignment(result, params, fellBackToSelected);
}

/**
 * Cut a match the sidecar still holds into captions again at another setting.
 *
 * Only the grouping is repeated -- see `regroup.py` in the sidecar -- so this
 * is what lets Fewer / More act at once. An `AlignRequestError` with code
 * `regroup_expired` means the sidecar no longer has it, and only a new match
 * can answer.
 */
export async function runRegroup(params: {
  serviceUrl: string;
  regroupId: string;
  breaks: ScreenBreaks;
  surah: number;
  start: number;
  end: number;
}): Promise<MatchResult> {
  const query = new URLSearchParams({ id: params.regroupId, breaks: params.breaks });
  const result = await askSidecar(params.serviceUrl, `/regroup?${query}`);
  return matchFromAlignment(result, params, false);
}

type AlignedSegment = AlignResponse['segments'][number];
type Verse = Awaited<ReturnType<typeof getRange>>[number];

/**
 * The aligned times of the words this segment actually covers.
 *
 * Filtered by *time* before being keyed by word index, which is the whole
 * point: when a reciter restarts a phrase, the same (verse, word index)
 * appears twice in the aligned stream with different times. Keying by index
 * alone would let the later utterance overwrite the earlier one, and the
 * first of the two segments would show the second one's timings.
 *
 * Containment is tested on each word's midpoint, so a word straddling a
 * segment edge by a few milliseconds of rounding still lands in the segment
 * that holds most of it, and never in both.
 */
function timingsFor(wordsByVerse: Map<string, AlignedWord[]>, segment: AlignedSegment) {
  return (wordsByVerse.get(segment.verse_key) || [])
    .filter(word => {
      const middle = (word.start + word.end) / 2;
      return middle >= segment.start && middle <= segment.end;
    })
    .map(word => ({ index: word.word_index, start: word.start, end: word.end }));
}

/** One sidecar segment as a caption of the studio's timeline. */
function toMatchSegment(segment: AlignedSegment, verses: Verse[], wordsByVerse: Map<string, AlignedWord[]>): MatchSegment {
  const [surahStr, verseStr] = segment.verse_key.split(':');
  const verse = verses.find(v => v.verseKey === segment.verse_key);
  const recited = (verse?.words || []).slice(segment.start_word, segment.end_word + 1);
  return {
    verseKey: segment.verse_key,
    surahNumber: Number(surahStr),
    verseNumber: Number(verseStr),
    startTime: segment.start,
    endTime: segment.end,
    confidence: Math.max(0, Math.min(1, segment.score)),
    checks: segment.checks?.length ? segment.checks : undefined,
    displayTextUthmani: recited.map(word => word.arabic).join(' '),
    // No translation of its own. This used to copy the ayah's translation
    // into every segment on the reasoning that per-word glosses are
    // grammatical fragments -- "(is) with Allah", "even though" -- that do
    // not compose into a sentence, and reading them in a row is worse than
    // reading the whole ayah.
    //
    // That reasoning stands, but it is not this function's to enforce. The
    // caption already carries the ayah's translation in `translation`, so
    // the copy changed nothing about what was drawn -- while
    // `displayTranslation` means "a line chosen for this segment
    // specifically" and outranks everything, including the word-by-word
    // option the studio now offers. Pre-filling it therefore did nothing
    // except make that option impossible on every aligned timeline. Left
    // empty, the caption falls through to the same ayah translation as
    // before, and someone who asks for word-by-word gets it.
    //
    // Gemini is different and keeps its own: it writes a real translation of
    // just the words it selected, which is not the ayah's.
    displayTranslation: '',
    // Exact word range, so the timeline doesn't have to re-derive which words
    // were recited by matching text -- which picks the wrong occurrence when
    // a word repeats inside one ayah.
    startWordIndex: segment.start_word,
    endWordIndex: segment.end_word,
    // Per-word times, so splitting a caption cuts between real words rather
    // than assuming every word took an equal share of the segment.
    wordTimings: timingsFor(wordsByVerse, segment),
    notes: segment.is_restart ? 'restarted phrase' : undefined
  };
}

/** Every caption of an alignment, with the text its words come from. */
export function alignedSegments(result: Pick<AlignResponse, 'words' | 'segments'>, verses: Verse[]): MatchSegment[] {
  const wordsByVerse = new Map<string, AlignedWord[]>();
  for (const word of result.words) {
    const bucket = wordsByVerse.get(word.verse_key);
    if (bucket) bucket.push(word);
    else wordsByVerse.set(word.verse_key, [word]);
  }
  return (result.segments || []).map(segment => toMatchSegment(segment, verses, wordsByVerse));
}

/** What the studio is told about how this timeline was made. */
function alignmentNotes(result: AlignResponse, rangeLabel: string, fellBackToSelected: boolean, restarts: number): string {
  const detected = result.detectedRange;
  const repeatNote = restarts ? ` ${restarts} restarted phrase(s) detected.` : '';
  return (
    (result.warning ? `⚠ ${result.warning} ` : '') +
    (detected
      ? `Detected ${rangeLabel} from the audio itself${result.assist === 'qul' ? ' with QUL\'s morphology and mutashabihat' : ''} (${Math.round(detected.confidence * 100)}% match on ` +
        `${detected.matched_phrases}/${detected.total_phrases} phrases) and force-aligned it`
      : fellBackToSelected
        ? `This sidecar can't detect the range from audio, so the selected range ${rangeLabel} was force-aligned instead — confirm it matches the recording`
        : `Force-aligned the selected text of ${rangeLabel}`) +
    ` (${result.model}). Every reference word has a timestamp by construction.${repeatNote}`
  );
}

/**
 * Every passage the alignment covers. Display text comes from the app's
 * corpus, and *every* aligned passage has to be fetched, not just the primary
 * one -- a recitation that opens with Al-Fatihah before the main surah
 * otherwise leaves those segments with no text at all.
 */
function alignedRanges(result: AlignResponse, params: { surah?: number; start?: number; end?: number }) {
  const detected = result.detectedRange;
  return detected?.ranges?.length
    ? detected.ranges.map(r => ({ surah: r.surah, start: r.start_ayah, end: r.end_ayah }))
    : [{ surah: detected?.surah ?? params.surah!, start: detected?.start_ayah ?? params.start!, end: detected?.end_ayah ?? params.end! }];
}

/** A sidecar alignment as the studio's match result, the same for a first match and a regroup. */
async function matchFromAlignment(
  result: AlignResponse,
  params: { surah?: number; start?: number; end?: number },
  fellBackToSelected: boolean
): Promise<MatchResult> {
  const detected = result.detectedRange;
  const ranges = alignedRanges(result, params);
  const verses = (await Promise.all(ranges.map(r => getRange(r.surah, r.start, r.end).catch(() => [])))).flat();

  if (!result.words?.length) {
    throw new Error('The alignment service returned no aligned words.');
  }
  const segments = alignedSegments(result, verses);
  const meanScore = result.meanScore ?? 0;
  const restarts = (result.segments || []).filter(segment => segment.is_restart).length;

  // Forced alignment fits whatever text it's handed, so a wrong ayah range
  // produces a complete, plausible-looking, entirely wrong timeline. The
  // sidecar flags that case on mean acoustic confidence -- pass it through
  // loudly rather than letting it look like a successful match.
  if (result.warning) {
    console.warn(`[forcedAligner] ${result.warning}`);
  }

  // Label every block that was aligned, not just the first -- an auto-detected
  // run routinely covers Al-Fatihah plus another surah, and a single-range
  // label would silently under-report what the timeline contains.
  const rangeLabel = ranges.map(r => `${r.surah}:${r.start}-${r.end}`).join(', ');
  console.log(
    `[forcedAligner] aligned ${result.words.length} word(s) from ${rangeLabel} ` +
      `(${detected ? 'auto-detected' : 'selected'}) into ${segments.length} segment(s); ${restarts} restart(s); ` +
      `mean ${meanScore.toFixed(4)}, coverage ${result.referenceCoverage ?? 'n/a'}, ` +
      `agreement ${result.decodeAgreement ?? 'n/a'}.`
  );

  return {
    audioDuration: result.audioDuration,
    confidence: meanScore,
    transcript: result.words.map(word => word.text).join(' '),
    segments,
    warning: result.warning || undefined,
    notes: alignmentNotes(result, rangeLabel, fellBackToSelected, restarts),
    regroupId: result.regroupId
  };
}
