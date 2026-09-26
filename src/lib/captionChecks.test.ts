import { describe, it, expect } from 'vitest';
import { captionChecks, nextToCheck, toCheckCount, markChecked, LOW_MATCH } from './captionChecks';
import { splitSegment, mergeWithNext } from './verseEdits';
import type { VerseData } from './quranData';

const caption = (over: Partial<VerseData> = {}): VerseData => ({
  verseNumber: 15,
  verseKey: '42:15',
  textUthmani: 'فَلِذَٰلِكَ فَٱدْعُ ۖ وَٱسْتَقِمْ كَمَآ أُمِرْتَ',
  translation: '',
  startTime: 0,
  endTime: 4,
  matchConfidence: 0.9,
  ...over,
});

describe('captionChecks', () => {
  it("marks a line the aligner ended on a stop mark alone, and a low score", () => {
    expect(captionChecks(caption({ checks: ['stop_mark'] }))).toEqual(['stop_mark']);
    expect(captionChecks(caption({ matchConfidence: 0.43 }))).toEqual(['low_match']);
    expect(captionChecks(caption({ checks: ['stop_mark'], matchConfidence: 0.2 }))).toEqual(['stop_mark', 'low_match']);
  });

  it('leaves a confident caption, and one with no score, alone', () => {
    expect(captionChecks(caption())).toEqual([]);
    expect(captionChecks(caption({ matchConfidence: LOW_MATCH }))).toEqual([]);
    expect(captionChecks(caption({ matchConfidence: undefined }))).toEqual([]);
  });

  it('drops the mark once the caption has been dealt with', () => {
    expect(captionChecks(caption({ checks: ['stop_mark'], matchConfidence: 0.2, checked: true }))).toEqual([]);
  });
});

describe('nextToCheck', () => {
  const verses = [
    caption(),
    caption({ checks: ['stop_mark'] }),
    caption(),
    caption({ matchConfidence: 0.3 }),
  ];

  it('goes forward from the selection and wraps round', () => {
    expect(nextToCheck(verses, 0)).toBe(1);
    expect(nextToCheck(verses, 1)).toBe(3);
    expect(nextToCheck(verses, 3)).toBe(1);
  });

  it('stays on the only one, and is null when none is left', () => {
    expect(nextToCheck([caption(), caption({ checks: ['stop_mark'] })], 1)).toBe(1);
    expect(nextToCheck([caption(), caption()], 0)).toBeNull();
    expect(nextToCheck([], 0)).toBeNull();
  });

  it('counts what is left', () => {
    expect(toCheckCount(verses)).toBe(2);
    expect(toCheckCount(markChecked(verses, 1))).toBe(1);
  });
});

describe('dealing with a marked caption', () => {
  const words = ['فَلِذَٰلِكَ', 'فَٱدْعُ ۖ', 'وَٱسْتَقِمْ', 'كَمَآ'].map((arabic, i) => ({ arabic, translation: '', timestamp: i + 0.5 }));
  const marked = caption({ checks: ['stop_mark'], matchConfidence: 0.3, words });

  it('"Looks right" unmarks it and leaves the rest', () => {
    const next = markChecked([marked, caption()], 0);
    expect(captionChecks(next[0])).toEqual([]);
    expect(next[1].checked).toBeUndefined();
  });

  it('does nothing to a caption that was not marked', () => {
    const verses = [caption()];
    expect(markChecked(verses, 0)).toBe(verses);
  });

  it('splitting or merging it unmarks the result', () => {
    const split = splitSegment([marked], 0, 2);
    expect(split).toHaveLength(2);
    expect(split.map(v => captionChecks(v))).toEqual([[], []]);
    const merged = mergeWithNext(split.map(v => ({ ...v, checked: false })), 0);
    expect(merged).toHaveLength(1);
    expect(captionChecks(merged[0])).toEqual([]);
  });
});
