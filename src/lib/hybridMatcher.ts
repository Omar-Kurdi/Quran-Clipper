/**
 * Hybrid matcher: Gemini identifies, the local aligner times.
 *
 * The two providers this composes each fail at exactly the job the other one
 * does well.
 *
 * Gemini can listen to a clip and tell you it is Al-Ahzab 33:21-23 -- that is
 * recognition, and it is good at it. What it cannot do is say *when* each word
 * was spoken: an LLM has no frame-level grounding, so its timestamps are
 * plausible-looking estimates and no amount of prompting changes that. See
 * docs/ALIGNMENT.md §1.
 *
 * Forced alignment is the mirror image. Given the text it places every word
 * exactly, and cannot drop, garble, or misplace one. But it cannot work out
 * *which* text -- and worse, it never says so: hand it the wrong ayahs and it
 * returns a complete, monotonic, confident-looking, entirely wrong timeline.
 *
 * So: ask each one only the question it can answer. Gemini picks the passage,
 * the sidecar times it. The result has the accurate timing of `align` without
 * needing the user to have selected the right range, and without needing the
 * sidecar's own auto-detection (which requires the heavy NeMo backend).
 *
 * The wrong-range failure mode does not disappear -- it moves. If Gemini
 * misidentifies the passage, the aligner faithfully aligns the wrong text.
 * `referenceCoverage` in the sidecar is what catches that (not `meanScore`,
 * which does not separate the two -- see README.md), and `needsReview` is
 * unconditionally true for this provider on top of it.
 *
 * **A spurious extra range is worse than a wrong single one.** Measured: with
 * a reference of Al-Fatihah + 33:21-23 against audio containing only 33:21-23,
 * the sidecar's phrase search starts its cursor at word 0, never escapes
 * Al-Fatihah, and emits segments for 1:1-1:2 only -- the real passage is not
 * aligned at all. So a hallucinated opening block does not merely add junk, it
 * derails the whole timeline. Coverage did flag it (0.10, warning set), which
 * is why that check matters more here than on the single-range paths, and why
 * the identify prompt is explicit about not inventing verses. Note this
 * fragility is not new to this provider: the sidecar's own auto-detection
 * builds a multi-range reference the same way.
 */

import { runGeminiIdentify, type GeminiRange } from '@/lib/geminiMatcher';
import { runForcedAlignMatch } from '@/lib/forcedAligner';
import type { MatchResult } from '@/lib/matchTypes';

function formatRanges(ranges: GeminiRange[]): string {
  return ranges.map(r => `${r.surah}:${r.start}-${r.end}`).join(', ');
}

export async function runHybridMatch(params: {
  apiKey: string;
  model: string;
  serviceUrl: string;
  audio: File;
  /** The UI's current selection, used as the fallback if identification fails. */
  selectedSurah: number;
  selectedStart: number;
  selectedEnd: number;
}): Promise<MatchResult> {
  let ranges: GeminiRange[] = [];
  let identifiedByGemini = false;
  let transcript = '';

  try {
    const identified = await runGeminiIdentify({
      apiKey: params.apiKey,
      model: params.model,
      audio: params.audio,
      selectedSurah: params.selectedSurah,
      selectedStart: params.selectedStart,
      selectedEnd: params.selectedEnd
    });
    ranges = identified.ranges;
    transcript = identified.transcript || '';
    if (ranges.length) {
      console.log(`[hybridMatcher] Gemini identified ${formatRanges(ranges)} (${params.model}).`);
      identifiedByGemini = true;
    }
  } catch (err) {
    // A failed identification is recoverable, so it must not take the whole
    // request down -- the UI's selected range is very often correct, and
    // aligning that is strictly better than returning an error.
    console.warn(`[hybridMatcher] Gemini identification failed, falling back to the selected range:`, (err as Error).message);
  }

  if (!ranges.length) {
    // Deliberately NOT the sidecar's `autoDetect`: that path needs
    // ASR_ALIGN_BACKEND=nemo and returns an HTTP 400 about NeMo backends on a
    // CPU-only deployment -- an error about the wrong subsystem entirely. The
    // UI selection works on every backend.
    ranges = [{ surah: params.selectedSurah, start: params.selectedStart, end: params.selectedEnd }];
    identifiedByGemini = false;
  }

  const aligned = await runForcedAlignMatch({
    serviceUrl: params.serviceUrl,
    audio: params.audio,
    ranges
  });

  // `runForcedAlignMatch` writes its own "Force-aligned the selected text of X"
  // sentence, which reads as a non-sequitur after this provider's own summary
  // and repeats the range. Replace it rather than concatenating the two.
  const label = formatRanges(ranges);
  const origin = identifiedByGemini
    ? `Gemini identified ${label} from the audio`
    : `Gemini could not identify the passage, so the selected range ${label} was used`;

  return {
    ...aligned,
    // Gemini's transcript is a real free transcription of the audio; the
    // aligner's is just the reference text read back, which tells you nothing
    // you didn't supply. Prefer Gemini's when it produced one.
    transcript: transcript || aligned.transcript,
    notes:
      (aligned.warning ? `⚠ ${aligned.warning} ` : '') +
      `${origin}, then force-aligned locally — every word is timed against the real Quran text. ` +
      `Confirm the range matches your recording.`
  };
}
