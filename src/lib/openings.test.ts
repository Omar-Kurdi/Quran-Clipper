import { describe, it, expect } from 'vitest';
import { openingVerses, isOpening, type HeardOpening } from './openings';

const basmala: HeardOpening = {
  kind: 'basmala',
  text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ',
  start: 0.2,
  end: 5.5,
  words: [
    { text: 'بِسْمِ', start: 0.2 },
    { text: 'ٱللَّهِ', start: 0.88 },
    { text: 'ٱلرَّحْمَـٰنِ', start: 1.52 },
    { text: 'ٱلرَّحِيمِ', start: 2.64 }
  ]
};
const istiadha: HeardOpening = {
  kind: 'istiadha',
  text: 'أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ',
  start: 0.1,
  end: 3.9,
  words: [{ text: 'أَعُوذُ', start: 0.1 }, { text: 'بِٱللَّهِ', start: 0.7 }, { text: 'مِنَ', start: 1.2 }, { text: 'ٱلشَّيْطَـٰنِ', start: 1.5 }, { text: 'ٱلرَّجِيمِ', start: 2.6 }]
};

describe('openingVerses', () => {
  it('captions each opening heard, in order, up to the next and then the passage', () => {
    const verses = openingVerses([istiadha, { ...basmala, start: 4, end: 9 }], 9.5);
    expect(verses.map(v => [v.verseKey, v.verseNumber, v.startTime, v.endTime])).toEqual([
      ['istiadha', 0, 0.1, 4],
      ['basmala', 0, 4, 9]
    ]);
    expect(verses[0].words?.map(w => w.timestamp)).toEqual([0.1, 0.7, 1.2, 1.5, 2.6]);
  });

  it('never runs into the passage', () => {
    expect(openingVerses([basmala], 5)[0].endTime).toBe(5);
    expect(openingVerses([{ ...basmala, start: 6 }], 5)).toEqual([]);
  });

  it('draws the basmala from 1:1\'s own page glyphs, keeping its own times', () => {
    const page = basmala.words.map((w, i) => ({ arabic: w.text, translation: `t${i}`, glyph: `g${i}`, glyphPage: 1 }));
    const [verse] = openingVerses([basmala], 5.5, page);
    expect(verse.words?.[1]).toMatchObject({ glyph: 'g1', glyphPage: 1, timestamp: 0.88, translation: 't1' });
  });

  it('reads nothing it does not know', () => {
    expect(openingVerses(undefined, 5)).toEqual([]);
    expect(openingVerses([{ ...basmala, kind: 'takbir' as never }], 9)).toEqual([]);
  });
});

describe('isOpening', () => {
  it('tells an opening from an ayah by its key', () => {
    expect(isOpening({ verseKey: 'basmala' })).toBe(true);
    expect(isOpening({ verseKey: '1:1' })).toBe(false);
  });
});
