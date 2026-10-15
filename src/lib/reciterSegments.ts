/**
 * One ayah of a built-in reciter as published: its bounds in the passage
 * recording and its words' timings there, milliseconds on the recording's own
 * clock -- the clock the timeline, the playhead, the canvas and the exporter
 * all read against. Built by `qfRecitations` from the Quran Foundation's ayah
 * files; read by `publishedPhrases`.
 */
export interface ReciterVerseTiming {
  from: number;
  to: number;
  /** `[wordIndex, startMs, endMs]`, 1-based over the ayah's words. */
  segments?: number[][];
}
