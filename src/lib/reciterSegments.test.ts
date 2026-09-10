import { describe, it, expect } from 'vitest';
import { versesFromReciterSegments, ReciterVerseTiming, SegmentSourceVerse } from './reciterSegments';

const source = (verseKey: string, wordCount: number): SegmentSourceVerse => ({
  verseKey,
  verseNumber: Number(verseKey.split(':')[1]),
  textUthmani: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ'.split(' ').slice(0, wordCount).join(' '),
  translation: 'Say, He is Allah, the One',
  words: Array.from({ length: wordCount }, (_, i) => ({
    arabic: `w${i + 1}`,
    translation: `gloss ${i + 1}`,
    excluded: false
  }))
});

// The shape quran.com actually publishes: absolute milliseconds on the
// recording's clock, one-based word index.
const timing = (from: number, to: number, segments?: number[][]): ReciterVerseTiming =>
  ({ from, to, segments });

describe('a timeline from the reciter’s own timings', () => {
  it('puts each word at the moment it was recited', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 4)],
      new Map([['112:1', timing(0, 3170, [[1, 0, 760], [2, 760, 1250], [3, 1250, 2050], [4, 2050, 2825]])]])
    );
    expect(built.verses[0].words?.map(w => w.timestamp)).toEqual([0, 0.76, 1.25, 2.05]);
    expect(built.timedWords).toBe(1);
  });

  it('keeps the recording’s own clock rather than rebasing to zero', () => {
    // 1:2 starts three seconds into the surah audio, and everything the studio
    // plays against reads absolute times.
    const built = versesFromReciterSegments(
      [source('1:2', 4)],
      new Map([['1:2', timing(3080, 7570, [[1, 3080, 4050], [2, 4050, 4920], [3, 4920, 5510], [4, 5510, 7165]])]])
    );
    expect(built.verses[0].startTime).toBe(3.1);
    expect(built.verses[0].words?.[0].timestamp).toBe(3.08);
  });

  it('carries the ayah through even when only its bounds were timed', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 4)],
      new Map([['112:1', timing(0, 3170)]])
    );
    expect(built.verses).toHaveLength(1);
    expect(built.verses[0].words?.every(w => w.timestamp === undefined)).toBe(true);
    expect(built.boundsOnly).toBe(1);
    expect(built.timedWords).toBe(0);
  });

  it('counts an ayah the reciter did not cover rather than inventing one', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 4), source('112:2', 3)],
      new Map([['112:1', timing(0, 3170, [[1, 0, 760]])]])
    );
    expect(built.verses.map(v => v.verseKey)).toEqual(['112:1']);
    expect(built.missing).toBe(1);
  });

  it('ignores a segment that says nothing usable', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 3)],
      new Map([['112:1', timing(0, 3000, [
        [1, 0, 500],
        [2, 900, 900],            // zero length
        [3, Number.NaN, 1500]     // not a number
      ])]])
    );
    expect(built.verses[0].words?.map(w => w.timestamp)).toEqual([0, undefined, undefined]);
  });

  it('reads only the first three numbers, since some reciters publish four', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 1)],
      new Map([['112:1', timing(0, 1000, [[1, 100, 800, 42]])]])
    );
    expect(built.verses[0].words?.[0].timestamp).toBe(0.1);
  });

  it('never produces a zero-length caption', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 1)],
      new Map([['112:1', timing(1000, 1020)]])
    );
    expect(built.verses[0].endTime).toBeGreaterThan(built.verses[0].startTime);
  });

  it('refuses a timing whose end is not after its start', () => {
    const built = versesFromReciterSegments(
      [source('112:1', 1)],
      new Map([['112:1', timing(5000, 5000)]])
    );
    expect(built.verses).toHaveLength(0);
    expect(built.missing).toBe(1);
  });
});
