/**
 * Local ASR audio-to-Quran-timeline matcher.
 *
 * Unlike Gemini, this provider splits the job in two:
 *  1. `asr-service` (Python sidecar) answers "which Arabic words were
 *     spoken, when, and where were the pauses?" — it knows nothing about
 *     the Quran.
 *  2. This file answers "which ayahs are those?" by aligning the
 *     recognized words against the *entire* Quran (`quranCorpus.ts`), using
 *     fuzzy word matching (`arabic.ts`) to absorb the ASR model's
 *     transcription errors. The surah/ayah aren't assumed from the UI --
 *     they're discovered from the audio itself.
 *
 * No API key, no per-request cost, and the audio never leaves the machine
 * running the sidecar.
 */

import { buildFullQuranPool, CorpusVerse } from '@/lib/quranCorpus';
import { skeletonize, skeletonSimilarity } from '@/lib/arabic';
import type { MatchResult, MatchSegment } from '@/lib/matchTypes';
import type { VerseWord } from '@/lib/quranData';

type AsrWord = { text: string; start: number; end: number; score: number };
type VoicedRegion = { start: number; end: number; wordCount: number; text: string };
type AsrResponse = {
  success: boolean;
  backend: string;
  model: string;
  audioDuration: number;
  transcript: string;
  words: AsrWord[];
  voicedRegions: VoicedRegion[];
};

/** Segments below this text-similarity score are dropped rather than shown as a wrong guess. */
const MIN_PHRASE_SIMILARITY = 0.38;

/** How many leading skeleton characters to index candidate start positions by. */
const PREFIX_LEN = 2;

/**
 * Phrases at or below this length get a local-window fallback and a much
 * stronger continuity bias -- a word or two of ASR text barely disambiguates
 * on its own (Arabic's short verb/particle prefixes make first-letter
 * mishearing common), so they lean much more heavily on "probably right
 * after the last thing we matched" than long phrases do.
 */
const SHORT_PHRASE_LEN = 2;
const SHORT_PHRASE_LOCAL_WINDOW = 60;

async function transcribeWithAsrService(params: { serviceUrl: string; audio: File; minSilenceMs?: number }): Promise<AsrResponse> {
  const formData = new FormData();
  formData.append('audio', params.audio);
  if (params.minSilenceMs) formData.append('min_silence_ms', String(params.minSilenceMs));

  const base = params.serviceUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/transcribe`, { method: 'POST', body: formData });
  } catch {
    throw new Error(`Could not reach the ASR service at ${base}. Is it running? See asr-service/README.md.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ASR service failed (${res.status}): ${detail.slice(0, 300) || res.statusText}`);
  }
  return res.json();
}

type CorpusToken = { verseKey: string; wordIndex: number; word: VerseWord; skeleton: string };

/** Flattens the pool to word-level tokens and precomputes each one's skeleton once. */
function flattenPool(pool: CorpusVerse[]): CorpusToken[] {
  const tokens: CorpusToken[] = [];
  for (const verse of pool) {
    verse.words.forEach((word, wordIndex) => {
      tokens.push({ verseKey: verse.verseKey, wordIndex, word, skeleton: skeletonize(word.arabic) });
    });
  }
  return tokens;
}

/**
 * A word's own skeleton prefix, plus the prefix with one leading character
 * dropped. Arabic glues single-letter prefixes (و/ف/ب/ل/ك, and verb-form
 * prefixes ي/ت/ن/أ) directly onto the following word, and ASR models
 * routinely add or drop them -- indexing/querying both forms means a
 * dropped or hallucinated leading letter on either side still finds a match.
 */
function candidateKeysFor(skeleton: string): string[] {
  const keys = [skeleton.slice(0, PREFIX_LEN)];
  if (skeleton.length > PREFIX_LEN) keys.push(skeleton.slice(1, 1 + PREFIX_LEN));
  return keys;
}

/**
 * Maps a skeleton's leading characters (see `candidateKeysFor`) to every
 * corpus position that could plausibly start there, so a phrase's first word
 * narrows the search from "every position in the whole Quran" down to a few
 * hundred plausible starts, instead of a brute-force scan of all ~77,000
 * words for every phrase.
 */
function buildPrefixIndex(corpus: CorpusToken[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  corpus.forEach((token, i) => {
    if (!token.skeleton) return;
    for (const key of candidateKeysFor(token.skeleton)) {
      const bucket = index.get(key);
      if (bucket) bucket.push(i);
      else index.set(key, [i]);
    }
  });
  return index;
}

/** Assigns each ASR word to the voiced region containing it, and remembers that region's end time. */
type PhraseGroup = { words: AsrWord[]; regionEnd: number };

function groupWordsByRegion(words: AsrWord[], regions: VoicedRegion[]): PhraseGroup[] {
  if (!regions.length) {
    return words.length ? [{ words, regionEnd: words[words.length - 1].end }] : [];
  }

  const groups: AsrWord[][] = regions.map(() => []);
  let regionIdx = 0;
  for (const word of words) {
    while (regionIdx < regions.length - 1 && word.start >= regions[regionIdx].end) regionIdx++;
    groups[regionIdx].push(word);
  }
  return groups.map((g, i) => ({ words: g, regionEnd: regions[i].end })).filter(g => g.words.length > 0);
}

type PhraseMatch = { start: number; compareLen: number; tokenScores: number[]; avgScore: number };

/**
 * Core scoring loop, shared by the global prefix-indexed search and the
 * local "smoothing" re-match: scores every candidate start position against
 * the phrase (as-is, and with one fewer corpus word, to tolerate an ASR
 * insertion), applying whatever penalty function the caller supplies.
 */
function scoreCandidates(
  phraseSkeletons: string[],
  corpus: CorpusToken[],
  candidateStarts: number[],
  penaltyFor: (start: number) => number
): PhraseMatch | null {
  if (!phraseSkeletons.length || !candidateStarts.length) return null;

  const candidateLengths = Array.from(new Set([phraseSkeletons.length, Math.max(1, phraseSkeletons.length - 1)]));
  let best: PhraseMatch | null = null;

  for (const windowLen of candidateLengths) {
    const compareLen = Math.min(windowLen, phraseSkeletons.length);
    for (const start of candidateStarts) {
      if (start + windowLen > corpus.length) continue;

      const tokenScores: number[] = new Array(compareLen);
      let sum = 0;
      for (let i = 0; i < compareLen; i++) {
        const s = skeletonSimilarity(phraseSkeletons[i], corpus[start + i].skeleton);
        tokenScores[i] = s;
        sum += s;
      }
      const rawScore = sum / compareLen;
      const score = rawScore - penaltyFor(start);

      if (!best || score > best.avgScore) {
        best = { start, compareLen, tokenScores, avgScore: score };
      }
    }
  }
  return best;
}

/**
 * Finds the best-scoring contiguous span of corpus tokens for a run of ASR
 * words. Candidate start positions come from the prefix index (both
 * directions, see `candidateKeysFor`) plus, for short phrases, a local
 * window around wherever the previous phrase left off -- short phrases don't
 * carry enough signal to trust a prefix-bucket match alone. A penalty for
 * jumping far from that same point discourages false matches to repeated
 * phrases elsewhere in the text, scaled harder for short phrases since they
 * have the least disambiguating power of their own.
 */
function matchPhrase(
  phraseWords: string[],
  corpus: CorpusToken[],
  prefixIndex: Map<string, number[]>,
  searchFrom: number
): PhraseMatch | null {
  if (!phraseWords.length || !corpus.length) return null;

  const phraseSkeletons = phraseWords.map(skeletonize);
  const candidateSet = new Set<number>();
  for (const key of candidateKeysFor(phraseSkeletons[0])) {
    const bucket = prefixIndex.get(key);
    if (bucket) for (const idx of bucket) candidateSet.add(idx);
  }

  const isShortPhrase = phraseWords.length <= SHORT_PHRASE_LEN;
  if (isShortPhrase) {
    const lo = Math.max(0, searchFrom - SHORT_PHRASE_LOCAL_WINDOW);
    const hi = Math.min(corpus.length - 1, searchFrom + SHORT_PHRASE_LOCAL_WINDOW);
    for (let i = lo; i <= hi; i++) candidateSet.add(i);
  }

  // Nothing indexed at all (garbled first word) -- fall back to a full scan rather than
  // silently giving up. Rare in practice.
  const candidateStarts = candidateSet.size ? Array.from(candidateSet) : corpus.map((_, i) => i);

  const proportionalScale = isShortPhrase ? 3.0 : phraseWords.length <= 4 ? 1.0 : 0.3;
  const maxPenalty = isShortPhrase ? 0.5 : phraseWords.length <= 4 ? 0.25 : 0.15;
  const penaltyFor = (start: number) =>
    Math.min(maxPenalty, (Math.abs(start - searchFrom) / Math.max(corpus.length, 1)) * proportionalScale);

  return scoreCandidates(phraseSkeletons, corpus, candidateStarts, penaltyFor);
}

/**
 * How far around a neighboring segment's position to look when re-matching an
 * "island" phrase -- one whose surah differs from both the phrase before and
 * after it, which almost always means it landed on a coincidental match to a
 * formulaic phrase that recurs elsewhere in the Quran (e.g. "فلما رأى...")
 * rather than a real jump. Generous enough to cover a couple of ayahs.
 */
const SMOOTHING_LOCAL_WINDOW = 120;

/**
 * Re-matches a phrase restricted to a small window of corpus positions, with
 * no distance penalty (the window itself is already the constraint). Used to
 * correct island phrases during smoothing -- see `SMOOTHING_LOCAL_WINDOW`.
 */
function matchPhraseLocal(phraseWords: string[], corpus: CorpusToken[], anchor: number): PhraseMatch | null {
  const lo = Math.max(0, anchor - SMOOTHING_LOCAL_WINDOW);
  const hi = Math.min(corpus.length - 1, anchor + SMOOTHING_LOCAL_WINDOW);
  const candidateStarts: number[] = [];
  for (let i = lo; i <= hi; i++) candidateStarts.push(i);

  return scoreCandidates(phraseWords.map(skeletonize), corpus, candidateStarts, () => 0);
}

/** How much longer than the last recognized word a voiced region has to run before we
 *  suspect the ASR model dropped one or more trailing words rather than the recitation
 *  just pausing. */
const TRAILING_GAP_SEC = 0.22;

/** Hard cap on how many consecutive words we'll assume were dropped from one gap, so a
 *  genuinely long pause (not a drop) can't snowball into fabricating a whole phrase. */
const MAX_ASSUMED_DROPPED_WORDS = 4;

type PhraseResult = { phrase: PhraseGroup; match: PhraseMatch; matchedSurah: number };

/** Aligns ASR word/pause output to the candidate pool, producing Gemini-shaped segments. */
export function alignAsrToQuran(params: { words: AsrWord[]; voicedRegions: VoicedRegion[]; pool: CorpusVerse[] }): MatchSegment[] {
  const corpus = flattenPool(params.pool);
  if (!corpus.length) return [];

  const prefixIndex = buildPrefixIndex(corpus);
  console.log(`[asrAligner] full Quran pool: ${params.pool.length} ayahs, ${corpus.length} words, ${prefixIndex.size} prefix buckets.`);

  const phrases = groupWordsByRegion(params.words, params.voicedRegions);
  console.log(
    `[asrAligner] ASR transcript ("${params.words.map(w => w.text).join(' ')}") ` +
      `split into ${phrases.length} phrase(s) by pause detection.`
  );

  // Pass 1: match each phrase in order, in the sequence it was recited (searchFrom
  // carries forward only from accepted matches, so continuity bias stays meaningful).
  const results: (PhraseResult | null)[] = [];
  let searchFrom = 0;

  phrases.forEach((phrase, phraseIdx) => {
    const phraseWords = phrase.words.map(w => w.text);
    const match = matchPhrase(phraseWords, corpus, prefixIndex, searchFrom);

    if (!match) {
      console.log(`[asrAligner] phrase ${phraseIdx}: "${phraseWords.join(' ')}" — no candidate span found. Skipped.`);
      results.push(null);
      return;
    }

    const matchedVerseKeys = Array.from(
      new Set(corpus.slice(match.start, match.start + match.compareLen).map(t => t.verseKey))
    );
    const status = match.avgScore < MIN_PHRASE_SIMILARITY ? 'DROPPED (below threshold)' : 'accepted';
    console.log(
      `[asrAligner] phrase ${phraseIdx}: "${phraseWords.join(' ')}" -> best match [${matchedVerseKeys.join(', ')}] ` +
        `score=${match.avgScore.toFixed(3)} (threshold=${MIN_PHRASE_SIMILARITY}) — ${status}`
    );

    if (match.avgScore < MIN_PHRASE_SIMILARITY) {
      results.push(null);
      return;
    }

    searchFrom = match.start + match.compareLen;
    const matchedSurah = Number(corpus[match.start].verseKey.split(':')[0]);
    results.push({ phrase, match, matchedSurah });
  });

  // Pass 2: smoothing. A RUN of one or more consecutive phrases whose surah differs
  // from a shared surah on both sides is almost always a coincidental match --
  // formulaic phrases recur across the Quran (e.g. "فلما رأى...") and a decoding
  // artifact (garbled/hallucinated tokens) in even one word of a phrase can drag its
  // whole match to an unrelated surah -- rather than a real jump away and back.
  // Re-match each phrase in the run in sequence, anchored off wherever the previous
  // (already-corrected) phrase left off, accepting a lower raw score than the original
  // wrong-surah match -- staying in the recitation's actual surah matters more than
  // peak text similarity. Handles runs of any length, not just a single isolated phrase.
  {
    let i = 1;
    while (i <= results.length - 2) {
      const prev = results[i - 1];
      if (!prev || !results[i] || results[i]!.matchedSurah === prev.matchedSurah) {
        i++;
        continue;
      }

      let runEnd = i;
      while (runEnd <= results.length - 2 && results[runEnd] && results[runEnd]!.matchedSurah !== prev.matchedSurah) {
        runEnd++;
      }
      const next = results[runEnd];

      if (next && next.matchedSurah === prev.matchedSurah) {
        let anchor = prev.match.start + prev.match.compareLen;
        for (let j = i; j < runEnd; j++) {
          const cur = results[j];
          if (!cur) continue;
          const phraseWords = cur.phrase.words.map(w => w.text);
          const localMatch = matchPhraseLocal(phraseWords, corpus, anchor);

          if (localMatch && localMatch.avgScore >= MIN_PHRASE_SIMILARITY) {
            const localSurah = Number(corpus[localMatch.start].verseKey.split(':')[0]);
            console.log(
              `[asrAligner] smoothing: phrase ${j} (run of ${runEnd - i}, surah ${prev.matchedSurah} on both sides) matched surah ` +
                `${cur.matchedSurah} -- re-matched locally to surah ${localSurah} score=${localMatch.avgScore.toFixed(3)} (was ${cur.match.avgScore.toFixed(3)})`
            );
            results[j] = { phrase: cur.phrase, match: localMatch, matchedSurah: localSurah };
            anchor = localMatch.start + localMatch.compareLen;
          } else {
            console.log(
              `[asrAligner] smoothing: phrase ${j} (run of ${runEnd - i}, surah ${prev.matchedSurah} on both sides) matched surah ` +
                `${cur.matchedSurah}, no good local alternative found (best=${localMatch ? localMatch.avgScore.toFixed(3) : 'none'}) -- keeping original match.`
            );
            anchor = cur.match.start + cur.match.compareLen;
          }
        }
      }

      i = runEnd + 1;
    }
  }

  // Pass 3: build segments from the (possibly corrected) matches.
  const segments: MatchSegment[] = [];

  results.forEach((result, phraseIdx) => {
    if (!result) return;
    const { phrase, match } = result;
    const segmentsBeforeThisPhrase = segments.length;

    // Split the matched span into contiguous per-ayah runs (a phrase can cross an ayah boundary).
    let runStartIdx = 0;
    while (runStartIdx < match.compareLen) {
      const runVerseKey = corpus[match.start + runStartIdx].verseKey;
      let runEndIdx = runStartIdx;
      while (runEndIdx + 1 < match.compareLen && corpus[match.start + runEndIdx + 1].verseKey === runVerseKey) {
        runEndIdx++;
      }

      const runTokens = corpus.slice(match.start + runStartIdx, match.start + runEndIdx + 1);
      const runWords = phrase.words.slice(runStartIdx, runEndIdx + 1);
      const runScores = match.tokenScores.slice(runStartIdx, runEndIdx + 1);
      const textSimilarity = runScores.reduce((a, b) => a + b, 0) / runScores.length;
      const avgAsrScore = runWords.reduce((a, w) => a + (w.score || 0.7), 0) / runWords.length;

      // Any leftover ASR words beyond the matched window (window shorter than the phrase)
      // extend this run's end time rather than being dropped silently.
      const isLastRun = runEndIdx === match.compareLen - 1;
      const leftoverWords = isLastRun ? phrase.words.slice(match.compareLen) : [];
      const endWord = leftoverWords.length ? leftoverWords[leftoverWords.length - 1] : runWords[runWords.length - 1];

      const [surahStr, verseStr] = runVerseKey.split(':');
      segments.push({
        verseKey: runVerseKey,
        surahNumber: Number(surahStr),
        verseNumber: Number(verseStr),
        startTime: runWords[0].start,
        endTime: endWord.end,
        confidence: Math.max(0, Math.min(1, 0.6 * textSimilarity + 0.4 * avgAsrScore)),
        displayTextUthmani: runTokens.map(t => t.word.arabic).join(' '),
        displayTranslation: runTokens.map(t => t.word.translation).filter(Boolean).join(' ')
      });

      runStartIdx = runEndIdx + 1;
    }

    // If the voiced region kept going well past the last word the ASR model actually
    // recognized, it likely swallowed one or more trailing words entirely (common with
    // quiet ayah-final words) rather than the recitation genuinely pausing right there.
    // Estimate how many words plausibly fit the gap from this phrase's own recitation
    // pace, and append that many -- as long as they continue the same ayah we just
    // matched. Their timing comes from the measured region boundary, not a heard word.
    const lastAsrWord = phrase.words[phrase.words.length - 1];
    const trailingGap = phrase.regionEnd - lastAsrWord.end;
    if (trailingGap > TRAILING_GAP_SEC && segments.length > segmentsBeforeThisPhrase) {
      const wordDurations = phrase.words.map(w => w.end - w.start).filter(d => d > 0);
      const avgWordDuration = wordDurations.length ? wordDurations.reduce((a, b) => a + b, 0) / wordDurations.length : 0.3;
      const estimatedMissingWords = Math.min(
        MAX_ASSUMED_DROPPED_WORDS,
        Math.max(1, Math.round(trailingGap / Math.max(avgWordDuration, 0.15)))
      );

      const lastSegment = segments[segments.length - 1];
      let cursor = match.start + match.compareLen;
      let appended = 0;
      while (appended < estimatedMissingWords && cursor < corpus.length && corpus[cursor].verseKey === lastSegment.verseKey) {
        const extra = corpus[cursor].word;
        lastSegment.displayTextUthmani = `${lastSegment.displayTextUthmani} ${extra.arabic}`.trim();
        if (extra.translation) {
          lastSegment.displayTranslation = `${lastSegment.displayTranslation || ''} ${extra.translation}`.trim();
        }
        cursor++;
        appended++;
      }

      if (appended > 0) {
        lastSegment.endTime = phrase.regionEnd;
        console.log(
          `[asrAligner] phrase ${phraseIdx}: trailing gap ${trailingGap.toFixed(2)}s (~${estimatedMissingWords} word budget) -- ` +
            `appended ${appended} likely-dropped word(s) to ${lastSegment.verseKey}`
        );
      }
    }
  });

  console.log(`[asrAligner] produced ${segments.length} segment(s) from ${phrases.length} phrase(s).`);

  return segments;
}

export async function runAsrMatch(params: { serviceUrl: string; audio: File; minSilenceMs?: number }): Promise<MatchResult> {
  const asrResult = await transcribeWithAsrService({
    serviceUrl: params.serviceUrl,
    audio: params.audio,
    minSilenceMs: params.minSilenceMs
  });

  if (!asrResult.words?.length) {
    throw new Error('The ASR service returned no recognized words. Try a clearer recording or use manual matching.');
  }

  console.log(
    `[asrAligner] request: ASR backend=${asrResult.backend}/${asrResult.model}, ${asrResult.words.length} words, ` +
      `${asrResult.voicedRegions?.length ?? 0} voiced regions. Searching the full Quran (surah/ayah not assumed from the UI).`
  );

  const pool = await buildFullQuranPool();
  const segments = alignAsrToQuran({ words: asrResult.words, voicedRegions: asrResult.voicedRegions, pool });

  if (!segments.length) {
    throw new Error(
      'Recognized speech could not be confidently aligned to any Quran ayah. Try a clearer recording, or use manual matching.'
    );
  }

  const avgConfidence = segments.reduce((sum, seg) => sum + (seg.confidence || 0), 0) / segments.length;

  return {
    audioDuration: asrResult.audioDuration,
    confidence: avgConfidence,
    transcript: asrResult.transcript,
    segments,
    notes: `Aligned via local ASR (${asrResult.backend}/${asrResult.model}) against the full Quran text (${pool.length} ayahs).`
  };
}
