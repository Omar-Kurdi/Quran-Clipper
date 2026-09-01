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
};

/**
 * Silence between two aligned words long enough to be a deliberate phrase
 * break rather than the micro-gap between words in continuous recitation.
 * This is a measurement on real word boundaries rather than a VAD-region
 * guess, which is why it can be a single threshold.
 */
const SEGMENT_GAP_SEC = 0.45;

async function requestAlignment(params: {
  serviceUrl: string;
  audio: File;
  reference: string;
}): Promise<AlignResponse> {
  const formData = new FormData();
  formData.append('audio', params.audio);
  formData.append('reference', params.reference);

  const base = params.serviceUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/align`, { method: 'POST', body: formData });
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
class AlignRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'AlignRequestError';
  }
}

/**
 * Cuts the aligned word stream into on-screen segments.
 *
 * A new segment starts at an ayah change, at a pause longer than
 * `SEGMENT_GAP_SEC`, or when the recitation crosses into (or out of) a
 * repeated phrase — a repeat is a separate thing to show, even mid-ayah.
 */
export function buildSegments(words: AlignedWord[]): MatchSegment[] {
  const segments: MatchSegment[] = [];
  let current: AlignedWord[] = [];

  const flush = () => {
    if (!current.length) return;
    const [surahStr, verseStr] = current[0].verse_key.split(':');
    const scores = current.map(word => word.score);
    segments.push({
      verseKey: current[0].verse_key,
      surahNumber: Number(surahStr),
      verseNumber: Number(verseStr),
      startTime: current[0].start,
      endTime: current[current.length - 1].end,
      confidence: Math.max(0, Math.min(1, scores.reduce((a, b) => a + b, 0) / scores.length)),
      displayTextUthmani: current.map(word => word.text).join(' '),
      notes: current[0].is_repeat ? 'repeated phrase' : undefined
    });
    current = [];
  };

  words.forEach((word, index) => {
    if (index > 0) {
      const previous = words[index - 1];
      const changedVerse = word.verse_key !== previous.verse_key;
      const changedRepeat = word.is_repeat !== previous.is_repeat;
      const paused = word.start - previous.end > SEGMENT_GAP_SEC;
      if (changedVerse || changedRepeat || paused) flush();
    }
    current.push(word);
  });
  flush();

  return segments;
}

export async function runForcedAlignMatch(params: {
  serviceUrl: string;
  audio: File;
  /** Omit (or pass autoDetect) to have the sidecar work the passage out from the audio. */
  surah?: number;
  start?: number;
  end?: number;
  autoDetect?: boolean;
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
      .map(verse => `${verse.verseKey}\t${verse.words.map(word => word.arabic).join(' ')}`)
      .join('\n');
  }

  let result: AlignResponse;
  try {
    result = await requestAlignment({
      serviceUrl: params.serviceUrl,
      audio: params.audio,
      reference
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
      audio: params.audio,
      reference: selected
        .map(verse => `${verse.verseKey}\t${verse.words.map(word => word.arabic).join(' ')}`)
        .join('\n')
    });
    fellBackToSelected = true;
  }

  const detected = result.detectedRange;
  const surah = detected?.surah ?? params.surah!;
  const startAyah = detected?.start_ayah ?? params.start!;
  const endAyah = detected?.end_ayah ?? params.end!;

  // Display text comes from the app's corpus. Fetch *every* passage that was
  // aligned, not just the primary one -- a recitation that opens with
  // Al-Fatihah before the main surah otherwise leaves those segments with no
  // text at all.
  const ranges = detected?.ranges?.length
    ? detected.ranges.map(r => ({ surah: r.surah, start: r.start_ayah, end: r.end_ayah }))
    : [{ surah, start: startAyah, end: endAyah }];
  const verses = (await Promise.all(ranges.map(r => getRange(r.surah, r.start, r.end).catch(() => [])))).flat();

  if (!result.words?.length) {
    throw new Error('The alignment service returned no aligned words.');
  }

  const wordsByVerse = new Map<string, AlignedWord[]>();
  for (const word of result.words) {
    const bucket = wordsByVerse.get(word.verse_key);
    if (bucket) bucket.push(word);
    else wordsByVerse.set(word.verse_key, [word]);
  }

  const segments: MatchSegment[] = (result.segments || []).map(segment => {
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
      displayTextUthmani: recited.map(word => word.arabic).join(' '),
      // Translation is NOT. The corpus's per-word glosses are grammatical
      // fragments ("(is) with Allah", "even though") that do not compose into
      // a sentence -- concatenating the slice produced unreadable English.
      // Show the ayah's own translation for the segment instead.
      displayTranslation: verse?.translation || '',
      // Exact word range, so the timeline doesn't have to re-derive which words
      // were recited by matching text -- which picks the wrong occurrence when
      // a word repeats inside one ayah.
      startWordIndex: segment.start_word,
      endWordIndex: segment.end_word,
      notes: segment.is_restart ? 'restarted phrase' : undefined
    };
  });

  const meanScore = result.meanScore ?? 0;
  const restarts = (result.segments || []).filter(segment => segment.is_restart).length;
  const repeatNote = restarts ? ` ${restarts} restarted phrase(s) detected.` : '';

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
  const rangeLabel = ranges.map(r => `${r.surah}:${r.start}-${r.end}`).join(', ') || `${surah}:${startAyah}-${endAyah}`;
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
    notes:
      (result.warning ? `⚠ ${result.warning} ` : '') +
      (detected
        ? `Detected ${rangeLabel} from the audio itself (${Math.round(detected.confidence * 100)}% match on ` +
          `${detected.matched_phrases}/${detected.total_phrases} phrases) and force-aligned it`
        : fellBackToSelected
          ? `This sidecar can't detect the range from audio, so the selected range ${rangeLabel} was force-aligned instead — confirm it matches the recording`
          : `Force-aligned the selected text of ${rangeLabel}`) +
      ` (${result.model}). Every reference word has a timestamp by construction.${repeatNote}`
  };
}
