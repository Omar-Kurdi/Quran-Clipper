import { describe, expect, it } from 'vitest';
import type { VerseData } from './quranData';
import { MAX_SUGGESTION_SEC, suggestClips, suggestionId, suggestionLabel } from './clipSuggestions';

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
