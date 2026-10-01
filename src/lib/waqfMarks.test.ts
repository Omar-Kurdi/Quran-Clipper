import { describe, it, expect } from 'vitest';
import { detachWaqfSigns } from './waqfMarks';

describe('detachWaqfSigns', () => {
  it('takes out a sign joined to the end of its word and says which word it follows', () => {
    // 3:188 as `wrapCaption` hands it over: the sign already joined, no space.
    const { bare, signs } = detachWaqfSigns('فَلَا تَحْسَبَنَّهُم بِمَفَازَةٍۢ مِّنَ ٱلْعَذَابِۖ');
    expect(bare).toBe('فَلَا تَحْسَبَنَّهُم بِمَفَازَةٍۢ مِّنَ ٱلْعَذَابِ');
    expect(signs).toEqual([{ sign: 'ۖ', before: 'فَلَا تَحْسَبَنَّهُم بِمَفَازَةٍۢ مِّنَ ٱلْعَذَابِ' }]);
  });

  it('finds a sign in the middle of a line, measured against the line without the signs before it', () => {
    const { bare, signs } = detachWaqfSigns('أَلِيمٌۚ وَلِلَّهِ مُلْكُ ٱلْأَرْضِۗ وَٱللَّهُ');
    expect(bare).toBe('أَلِيمٌ وَلِلَّهِ مُلْكُ ٱلْأَرْضِ وَٱللَّهُ');
    expect(signs.map(s => s.before)).toEqual(['أَلِيمٌ', 'أَلِيمٌ وَلِلَّهِ مُلْكُ ٱلْأَرْضِ']);
  });

  it('leaves the vowel marks inside a word alone', () => {
    // Fathatan, shadda and the rest are part of the word, not stop signs.
    const line = 'مِّنَ ٱلْعَذَابِ';
    expect(detachWaqfSigns(line)).toEqual({ bare: line, signs: [] });
  });
});
