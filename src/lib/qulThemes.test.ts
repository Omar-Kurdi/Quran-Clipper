import { describe, expect, it } from 'vitest';
import { themesBySurah } from '../../scripts/qul-themes.mjs';

describe('themesBySurah', () => {
  // QUL's export lists every group twice.
  it('keeps each group once, in order, by surah', () => {
    const row = (surah: number, from: number, to: number, theme: string) => ({ surah, from, to, theme });
    const rows = [row(2, 8, 16, 'Hypocrites'), row(2, 6, 7, 'Warning'), row(2, 6, 7, 'Warning'), row(1, 1, 7, 'Opening'), row(2, 8, 16, 'Hypocrites')];
    expect(themesBySurah(rows)).toEqual({ 1: [[1, 7, 'Opening']], 2: [[6, 7, 'Warning'], [8, 16, 'Hypocrites']] });
  });

  it('drops a group overlapping the one before, and one with no theme or no ayahs', () => {
    const rows = [{ surah: 3, from: 1, to: 5, theme: 'A' }, { surah: 3, from: 4, to: 9, theme: 'B' },
      { surah: 3, from: 6, to: 7, theme: ' ' }, { surah: 3, from: 9, to: 8, theme: 'C' }, { surah: 3, from: 10, to: 12, theme: 'D' }];
    expect(themesBySurah(rows)).toEqual({ 3: [[1, 5, 'A'], [10, 12, 'D']] });
  });
});
