/**
 * Shared shapes produced by any audio-match provider (Gemini, local ASR, …)
 * before they're turned into a `VerseData[]` timeline by `matchTimeline.ts`.
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
