import { describe, it, expect } from 'vitest';
import {
  MIN_SEGMENT,
  setBoundary,
  nudgeBoundary,
  markBoundaryAt,
  reorder,
  toggleWord,
  addVerseAfter,
  removeVerse,
  duplicateVerse,
  segmentAt,
  formatTime,
  ensureWords,
  splitSegment,
  mergeWithNext,
} from './verseEdits';
import type { VerseData } from './quranData';

const verse = (verseKey: string, startTime: number, endTime: number, textUthmani = 'أ ب ج'): VerseData => ({
  verseNumber: Number(verseKey.split(':')[1]),
  verseKey,
  textUthmani,
  translation: 'text',
  startTime,
  endTime,
});

const timeline = () => [verse('33:21', 0, 5), verse('33:22', 5, 10), verse('33:23', 10, 15)];

describe('setBoundary', () => {
  it('cascades nothing when trimming a start', () => {
    const next = setBoundary(timeline(), 1, 'startTime', 6, 15);
    expect(next[1].startTime).toBe(6);
    expect(next[2].startTime).toBe(10);
  });

  it('will not let a start cross its own end', () => {
    const next = setBoundary(timeline(), 1, 'startTime', 99, 15);
    expect(next[1].startTime).toBeLessThanOrEqual(next[1].endTime - MIN_SEGMENT);
  });

  it('will not let a start reach behind the previous segment', () => {
    const next = setBoundary(timeline(), 1, 'startTime', 0, 15);
    expect(next[1].startTime).toBeGreaterThanOrEqual(timeline()[0].endTime);
  });

  it('clamps an end to the length of the audio', () => {
    const next = setBoundary(timeline(), 2, 'endTime', 999, 15);
    expect(next[2].endTime).toBe(15);
  });

  it('leaves the timeline alone for an index that does not exist', () => {
    const before = timeline();
    expect(setBoundary(before, 9, 'endTime', 3, 15)).toBe(before);
  });
});

describe('nudgeBoundary', () => {
  it('moves by a delta rather than to an absolute time', () => {
    expect(nudgeBoundary(timeline(), 0, 'endTime', 0.5, 15)[0].endTime).toBe(5.5);
  });
});

describe('markBoundaryAt', () => {
  it('ends this segment and hands the rest to the next', () => {
    const next = markBoundaryAt(timeline(), 0, 3)!;
    expect(next[0].endTime).toBe(3);
    expect(next[1].startTime).toBe(3);
  });

  it('refuses a mark that would leave no segment at all', () => {
    expect(markBoundaryAt(timeline(), 1, 4)).toBeNull();
  });
});

describe('reorder', () => {
  it('reseats the timeline so the new order is what actually plays', () => {
    const next = reorder(timeline(), 2, 0);
    expect(next.map(v => v.verseKey)).toEqual(['33:23', '33:21', '33:22']);
    expect(next[0].startTime).toBe(0);
    for (let i = 1; i < next.length; i++) {
      expect(next[i].startTime).toBeCloseTo(next[i - 1].endTime, 5);
    }
  });

  it('is a no-op for a move that goes nowhere', () => {
    const before = timeline();
    expect(reorder(before, 1, 1)).toBe(before);
  });
});

describe('toggleWord', () => {
  it('drops an excluded word from what is displayed', () => {
    const next = toggleWord(timeline(), 0, 1);
    expect(next[0].words?.[1].excluded).toBe(true);
    expect(next[0].displayTextUthmani).toBe('أ ج');
  });
});

describe('addVerseAfter', () => {
  it('continues the surah it was called in, not surah 1', () => {
    const { verses } = addVerseAfter(timeline(), 2);
    expect(verses[3].verseKey).toBe('33:24');
  });

  it('rolls into the next surah rather than inventing an ayah that does not exist', () => {
    // Al-Ahzab has 73 ayahs.
    const { verses } = addVerseAfter([verse('33:73', 0, 5)], 0);
    expect(verses[1].verseKey).toBe('34:1');
  });
});

describe('removeVerse', () => {
  it('closes the gap it leaves', () => {
    const next = removeVerse(timeline(), 1);
    expect(next.map(v => v.verseKey)).toEqual(['33:21', '33:23']);
    expect(next[1].startTime).toBe(5);
  });

  it('never removes the only segment', () => {
    const one = [verse('33:21', 0, 5)];
    expect(removeVerse(one, 0)).toBe(one);
  });
});

describe('duplicateVerse', () => {
  it('places the copy directly after and pushes the rest along', () => {
    const next = duplicateVerse(timeline(), 0, 30);
    expect(next).toHaveLength(4);
    expect(next[1].verseKey).toBe('33:21');
    expect(next[1].startTime).toBe(5);
    expect(next[2].startTime).toBe(10);
  });
});

describe('segmentAt', () => {
  it('finds the segment covering a time', () => {
    expect(segmentAt(timeline(), 7)).toBe(1);
  });

  it('clamps before the first segment rather than returning -1', () => {
    expect(segmentAt(timeline(), -3)).toBe(0);
  });

  it('stays on the last segment past the end', () => {
    expect(segmentAt(timeline(), 999)).toBe(2);
  });
});

describe('formatTime', () => {
  it('uses seconds under a minute', () => {
    expect(formatTime(12.44)).toBe('12.4s');
  });

  it('uses minutes past one, zero-padded', () => {
    expect(formatTime(125.3)).toBe('2:05.30');
  });

  it('never renders a negative time', () => {
    expect(formatTime(-5)).toBe('0.0s');
  });
});

describe('ensureWords', () => {
  it('splits the text when a verse carries no word list', () => {
    expect(ensureWords(verse('33:21', 0, 5)).map(w => w.arabic)).toEqual(['أ', 'ب', 'ج']);
  });
});

describe('splitSegment', () => {
  const one = () => [verse('66:8', 0, 10, 'أ ب ج د')];

  it('cuts the segment in two at the given time', () => {
    const next = splitSegment(one(), 0, 5);
    expect(next).toHaveLength(2);
    expect([next[0].startTime, next[0].endTime]).toEqual([0, 5]);
    expect([next[1].startTime, next[1].endTime]).toEqual([5, 10]);
  });

  it('keeps the ayah on both halves, since a caption never spans one', () => {
    const next = splitSegment(one(), 0, 5);
    expect(next[0].verseKey).toBe('66:8');
    expect(next[1].verseKey).toBe('66:8');
  });

  it('divides the words either side of the cut', () => {
    const next = splitSegment(one(), 0, 5);
    expect(next[0].words?.map(w => w.arabic)).toEqual(['أ', 'ب']);
    expect(next[1].words?.map(w => w.arabic)).toEqual(['ج', 'د']);
  });

  it('leaves neither half without a word, however lopsided the cut', () => {
    const early = splitSegment(one(), 0, 0.4);
    expect(early[0].words?.length).toBeGreaterThan(0);
    expect(early[1].words?.length).toBeGreaterThan(0);
  });

  it('uses word timestamps when the timeline carries them', () => {
    const timed: VerseData[] = [{
      ...verse('66:8', 0, 10, 'أ ب ج د'),
      words: [
        { arabic: 'أ', translation: '', timestamp: 1 },
        { arabic: 'ب', translation: '', timestamp: 2 },
        { arabic: 'ج', translation: '', timestamp: 8 },
        { arabic: 'د', translation: '', timestamp: 9 },
      ],
    }];
    // Proportional division would put the cut at the halfway word; the
    // timestamps say only two words had been said by 5s.
    const next = splitSegment(timed, 0, 5);
    expect(next[0].words?.map(w => w.arabic)).toEqual(['أ', 'ب']);
  });

  it('refuses a cut that would leave a sliver rather than making one', () => {
    const before = one();
    expect(splitSegment(before, 0, 0.05)).toBe(before);
    expect(splitSegment(before, 0, 9.99)).toBe(before);
  });

  it('refuses an index that does not exist', () => {
    const before = one();
    expect(splitSegment(before, 7, 5)).toBe(before);
  });

  it('carries an excluded word through without showing it', () => {
    const withExcluded: VerseData[] = [{
      ...verse('66:8', 0, 10, 'أ ب ج د'),
      words: [
        { arabic: 'أ', translation: '' },
        { arabic: 'ب', translation: '', excluded: true },
        { arabic: 'ج', translation: '' },
        { arabic: 'د', translation: '' },
      ],
    }];
    const next = splitSegment(withExcluded, 0, 5);
    expect(next[0].displayTextUthmani).toBe('أ');
    expect(next[0].words).toHaveLength(2);
  });
});

describe('mergeWithNext', () => {
  const pair = () => [verse('66:8', 0, 5, 'أ ب'), verse('66:8', 5, 12, 'ج د')];

  it('joins the two into one spanning both', () => {
    const next = mergeWithNext(pair(), 0);
    expect(next).toHaveLength(1);
    expect([next[0].startTime, next[0].endTime]).toEqual([0, 12]);
  });

  it('keeps the words of both, in order', () => {
    const next = mergeWithNext(pair(), 0);
    expect(next[0].words?.map(w => w.arabic)).toEqual(['أ', 'ب', 'ج', 'د']);
    expect(next[0].displayTextUthmani).toBe('أ ب ج د');
  });

  it('refuses to merge across an ayah boundary', () => {
    // A merged caption would have no single verse key to carry, and the badge,
    // the export naming and the word highlighting all assume it has one.
    const across = [verse('66:8', 0, 5), verse('66:9', 5, 10)];
    expect(mergeWithNext(across, 0)).toBe(across);
  });

  it('refuses when there is nothing after it', () => {
    const before = pair();
    expect(mergeWithNext(before, 1)).toBe(before);
  });

  it('round-trips with splitSegment', () => {
    const start = [verse('66:8', 0, 10, 'أ ب ج د')];
    const split = splitSegment(start, 0, 5);
    const merged = mergeWithNext(split, 0);
    expect(merged).toHaveLength(1);
    expect(merged[0].words?.map(w => w.arabic)).toEqual(['أ', 'ب', 'ج', 'د']);
    expect([merged[0].startTime, merged[0].endTime]).toEqual([0, 10]);
  });
});
