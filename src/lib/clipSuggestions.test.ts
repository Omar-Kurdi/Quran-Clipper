import { describe, expect, it } from 'vitest';
import type { VerseData } from './quranData';
import { MAX_SUGGESTION_SEC, carriesOn, rukuStartsOf, suggestClips, suggestionId, suggestionLabel, topicSections } from './clipSuggestions';

const verse = (verseKey: string, startTime: number, endTime: number): VerseData => ({
  verseNumber: Number(verseKey.split(':')[1]),
  verseKey,
  textUthmani: 'أ ب ج',
  translation: 'text',
  startTime,
  endTime,
});

/** Ayahs 3:1.. of the given lengths, with the given pause after each. */
function map(lengths: number[], pauses: number[] = []): VerseData[] {
  let at = 0;
  return lengths.map((length, i) => {
    const caption = verse(`3:${i + 1}`, at, at + length);
    at += length + (pauses[i] ?? 1);
    return caption;
  });
}

describe('suggestClips', () => {
  it('groups whole ayahs into runs about as long as asked, covering every ayah once', () => {
    const suggestions = suggestClips(map([20, 20, 20, 20, 20, 20]), 60, 200);
    expect(suggestions.map(s => [s.from, s.to])).toEqual([['3:1', '3:3'], ['3:4', '3:6']]);
  });

  it('ends a run where the reciter pauses longest, given the choice', () => {
    // 3:2 ends at 45 s with a long pause after it; 3:3 at 61 s with a short one.
    const suggestions = suggestClips(map([22, 22, 15, 30], [1, 4, 0.3]), 55, 200);
    expect(suggestions[0].to).toBe('3:2');
  });

  it('never runs longer than a Short can be, though a single ayah that long stands alone', () => {
    const suggestions = suggestClips(map([100, 100, 200, 30]), 180, 600);
    expect(suggestions.map(s => [s.from, s.to])).toEqual([['3:1', '3:1'], ['3:2', '3:2'], ['3:3', '3:3'], ['3:4', '3:4']]);
    expect(suggestions.filter(s => s.from !== '3:3').every(s => s.end - s.start <= MAX_SUGGESTION_SEC)).toBe(true);
  });

  it('opens and closes each run in the pauses around its ayahs', () => {
    const [first] = suggestClips(map([20, 20, 20], [2, 2]), 40, 100);
    expect(first.start).toBe(0);
    expect(first.end).toBeGreaterThan(42);
    expect(first.end).toBeLessThan(44);
  });

  it('suggests nothing for a recording with no ayahs mapped', () => {
    expect(suggestClips([], 60, 100)).toEqual([]);
  });
});

describe('suggestionId and suggestionLabel', () => {
  it('names a run by its ayahs', () => {
    expect(suggestionId({ from: '3:20', to: '3:22' })).toBe('3:20-3:22');
    expect(suggestionLabel({ from: '3:20', to: '3:22' })).toBe('3:20–22');
    expect(suggestionLabel({ from: '3:20', to: '3:20' })).toBe('3:20');
  });
});

const rukus = (starts: number[]) => ({ kind: 'ruku' as const, list: starts.map(first => ({ first })) });

describe('suggestClips by ruku', () => {
  const range = (list: ReturnType<typeof suggestClips>) => list.map(s => [s.from, s.to]);

  it('makes each ruku that fits a clip of its own, whatever the length asked would cut', () => {
    // Rukus at 3:1 (60 s) and 3:4 (60 s): at 90 s by length 3:1-3:4 would join half of one to the other.
    const list = suggestClips(map([20, 20, 20, 20, 20, 20]), 90, 200, rukus([1, 4]));
    expect(range(list)).toEqual([['3:1', '3:3'], ['3:4', '3:6']]);
    expect(list.map(s => s.section)).toEqual([{ kind: 'ruku', number: 1, of: 2 }, { kind: 'ruku', number: 2, of: 2 }]);
  });

  it('splits a ruku too long for a clip into numbered parts, inside the ruku', () => {
    const list = suggestClips(map([30, 30, 30, 30, 30, 30]), 60, 300, rukus([1]));
    expect(range(list)).toEqual([['3:1', '3:2'], ['3:3', '3:4'], ['3:5', '3:6']]);
    expect(list.map(s => s.section)).toEqual([1, 2, 3].map(part => ({ kind: 'ruku', number: 1, of: 1, part, parts: 3 })));
  });

  it('joins rukus shorter than the length asked while together they still fit', () => {
    const list = suggestClips(map([20, 20, 20, 20]), 90, 200, rukus([1, 3, 4]));
    expect(range(list)).toEqual([['3:1', '3:4']]);
  });

  it('does not start a part on an ayah that carries on from the one before', () => {
    const verses = map([30, 30, 30, 30]);
    verses[2] = { ...verses[2], textUthmani: 'فَأَخَذَتْهُمُ ٱلصَّيْحَةُ' };
    const list = suggestClips(verses, 60, 200, rukus([1]));
    expect(list.some(s => s.from === '3:3')).toBe(false);
  });
});

describe('carriesOn', () => {
  it('knows an ayah opened by fa, thumma or bal', () => {
    expect(carriesOn('فَأَخَذَتْهُمُ ٱلصَّيْحَةُ مُصْبِحِينَ')).toBe(true);
    expect(carriesOn('ثُمَّ إِنَّ رَبَّكَ')).toBe(true);
    expect(carriesOn('بَلْ هُمْ قَوْمٌ')).toBe(true);
    expect(carriesOn('وَلَقَدْ خَلَقْنَا ٱلْإِنسَـٰنَ')).toBe(false);
  });
});

describe('rukuStartsOf', () => {
  it('finds where each ruku begins', () => {
    const verses = [1, 2, 3, 4, 5].map(n => ({ verse_number: n, ruku_number: n < 3 ? 218 : 219 }));
    expect(rukuStartsOf(verses)).toEqual([1, 3]);
    expect(rukuStartsOf([])).toEqual([]);
  });
});

describe('suggestClips by topic', () => {
  it('names each clip by its topic, and joins short topics with theirs', () => {
    const topics = { kind: 'topic' as const, list: [{ first: 1, title: 'A' }, { first: 2, title: 'B' }, { first: 4, title: 'C' }] };
    const list = suggestClips(map([10, 20, 20, 30, 30]), 60, 200, topics);
    expect(list.map(s => [s.from, s.to, s.section?.title])).toEqual([['3:1', '3:3', 'A · B'], ['3:4', '3:5', 'C']]);
  });
});

describe('topicSections', () => {
  it('makes a section of every group, and of any ayahs no group covers', () => {
    // Al-Baqarah's export starts at 2:6 and skips 2:40-43.
    expect(topicSections([[6, 7, 'Warning'], [8, 39, 'Hypocrites'], [44, 44, 'Advice']])).toEqual([
      { first: 1 }, { first: 6, title: 'Warning' }, { first: 8, title: 'Hypocrites' }, { first: 40 }, { first: 44, title: 'Advice' },
    ]);
  });

  it('passes over a group overlapping the one before', () => {
    expect(topicSections([[1, 5, 'A'], [3, 6, 'B'], [6, 9, 'C']])).toEqual([{ first: 1, title: 'A' }, { first: 6, title: 'C' }]);
  });
});
