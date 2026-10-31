import { describe, it, expect } from 'vitest';
import { ayahMarker, AYAH_MARKER, endsAyah, markerDigits, markerStyleOf, pageEndGlyph, placementOf } from './ayahMarker';
import { wrapCaption } from './mushafFonts';
import { drawnWordTimes } from './arabicWords';

const verse = (extra = {}) => ({ verseNumber: 21, textUthmani: 'لَوْ أَنزَلْنَا هَـٰذَا', ...extra });

describe('the end-of-ayah marker', () => {
  it('is the number in Arabic digits between the ornate brackets', () => {
    expect(ayahMarker(21)).toBe('\u06DD٢١');
    expect(AYAH_MARKER.test(ayahMarker(286))).toBe(true);
    expect(AYAH_MARKER.test('أَنزَلْنَا')).toBe(false);
  });

  it('closes only the caption that reaches the ayah’s end', () => {
    const words = [{ arabic: 'لَوْ', translation: '' }, { arabic: 'أَنزَلْنَا', translation: '' }, { arabic: 'هَـٰذَا', translation: '' }];
    expect(endsAyah(verse({ words }))).toBe(true);
    // A long ayah's first part, or a repeat that stops mid-ayah.
    expect(endsAyah(verse({ words: words.map((w, i) => (i === 2 ? { ...w, excluded: true } : w)) }))).toBe(false);
    expect(endsAyah(verse({ displayTextUthmani: 'أَنزَلْنَا هَـٰذَا' }))).toBe(true);
    expect(endsAyah(verse({ displayTextUthmani: 'لَوْ أَنزَلْنَا' }))).toBe(false);
    // An opening has no number.
    expect(endsAyah(verse({ verseNumber: 0 }))).toBe(false);
  });

  it('is never alone at the start of a line', () => {
    const perChar = (line: string) => line.length;
    expect(wrapCaption(`alpha beta ${ayahMarker(7)}`, 9, perChar)).toEqual(['alpha', `beta ${ayahMarker(7)}`]);
  });

  it('takes no time of its own: it shows with the last word and is never the word being recited', () => {
    const words = [{ arabic: 'لَوْ', translation: '', timestamp: 1 }, { arabic: 'أَنزَلْنَا', translation: '', timestamp: 2 }];
    expect(drawnWordTimes(words, [`لَوْ أَنزَلْنَا ${ayahMarker(21)}`], 1)).toEqual([[1, 2, undefined]]);
  });

  it('is at the end of the ayah unless between the cards is chosen', () => {
    expect(placementOf(undefined)).toBe('end');
    expect(placementOf('between')).toBe('between');
    expect(placementOf('hidden')).toBe('end');
  });
});

describe('the ayah-ending styles', () => {
  it('draw the medallion unless another is chosen, as every project before them did', () => {
    expect(markerStyleOf(undefined)).toBe('medallion');
    expect(markerStyleOf('rosette')).toBe('medallion');
    expect(markerStyleOf('circle')).toBe('circle');
    expect(markerDigits(ayahMarker(286))).toBe('٢٨٦');
  });

  it('take the page face\'s end glyph as the code after the last word\'s, on its page', () => {
    // Al-Mulk 67:1 and 67:2 on page 562, as the upstream sends them.
    expect(pageEndGlyph([{ glyph: '\ufc48', glyphPage: 562 }, { glyph: '\ufc49', glyphPage: 562 }])).toEqual({ glyph: '\ufc4a', page: 562 });
    expect(pageEndGlyph([{ glyph: '\ufc52\ufc53', glyphPage: 562 }, { glyph: '\ufc56', glyphPage: 562 }])).toEqual({ glyph: '\ufc57', page: 562 });
    expect(pageEndGlyph([{ glyph: '\ufc52\ufc53', glyphPage: 562 }])).toEqual({ glyph: '\ufc54', page: 562 });
    expect(pageEndGlyph([{}])).toBeNull();
    expect(pageEndGlyph(undefined)).toBeNull();
  });
});
