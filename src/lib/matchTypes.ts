/**
 * Shared shapes produced by either audio-match provider (local forced
 * alignment, Gemini) before they're turned into a `VerseData[]` timeline by
 * `matchTimeline.ts`.
 */

export type MatchSegment = {
  verseKey?: string;
  verseNumber?: number;
  surahNumber?: number;
  startTime?: number;
  endTime?: number;
  confidence?: number;
  notes?: string;
  displayTextUthmani?: string;
  recitedTextUthmani?: string;
  displayTranslation?: string;
  /**
   * Which words of the ayah this segment covers, 0-based and inclusive.
   *
   * Set by providers that know it exactly (forced alignment). Without it the
   * timeline has to re-derive inclusion by matching text, which picks the
   * wrong occurrence whenever a word repeats inside one ayah -- e.g. 34:13
   * contains مِن twice, and the first was highlighted for a segment covering
   * the second.
   */
  startWordIndex?: number;
  endWordIndex?: number;
  /**
   * When each word of this segment was spoken, in seconds on the original
   * recording, keyed by the word's index within its ayah.
   *
   * Only providers that measure timing supply this -- forced alignment does,
   * Gemini estimates a segment span and nothing finer. Consumers must treat it
   * as absent rather than assuming a uniform reading speed.
   *
   * Keyed by word index rather than positional so a restarted phrase, which
   * repeats the same indices later in the recording, can carry the times of
   * *its* utterance: the entries are filtered to this segment's own span
   * before being indexed.
   */
  wordTimings?: { index: number; start: number; end: number }[];
};

export type MatchResult = {
  audioDuration?: number;
  confidence?: number;
  transcript?: string;
  segments: MatchSegment[];
  notes?: string;
  /**
   * Set when the provider itself believes the result is untrustworthy -- today
   * only the forced aligner, when the acoustics don't support the text it was
   * given. Kept as its own field rather than only as prose inside `notes` so
   * the route can act on it instead of parsing a sentence.
   */
  warning?: string;
};
