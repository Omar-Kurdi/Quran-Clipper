import { describe, it, expect } from 'vitest';
import {
  surahNameText, pagesUsedBy, canDrawAsMushaf, qpcPageFamily, qpcPageUrl, mushafCaption,
  QPC_V2, SURAH_NAME_FAMILY, withGlyphs, wrapCaption, mushafRows
} from './mushafFonts';

describe('surahNameText', () => {
  it('names the family the @font-face rule declares', () => {
    // The CSS and this constant have to agree or the badge silently falls back
    // to a Latin face; the name is the font's own, from its name table.
    expect(SURAH_NAME_FAMILY).toBe('surah-name-v4');
  });

  it('pads to three digits, which is what the ligature matches', () => {
    // Measured against the font: `surah9` draws nothing at all.
    expect(surahNameText(9)).toBe('surah009');
    expect(surahNameText(1)).toBe('surah001');
    expect(surahNameText(25)).toBe('surah025');
    expect(surahNameText(114)).toBe('surah114');
  });
});

describe('pagesUsedBy', () => {
  it('lists each page once, in the order the words need them', () => {
    expect(pagesUsedBy([
      { glyph: 'a', glyphPage: 48 },
      { glyph: 'b', glyphPage: 48 },
      { glyph: 'c', glyphPage: 49 }
    ])).toEqual([48, 49]);
  });

  it('keeps both pages when one verse straddles a page break', () => {
    // Keyed per word, never per verse: a verse can end one page and run onto
    // the next, and loading only the first would leave half of it blank.
    expect(pagesUsedBy([{ glyph: 'a', glyphPage: 205 }, { glyph: 'b', glyphPage: 206 }]))
      .toEqual([205, 206]);
  });

  it('ignores words the upstream sent no glyph for', () => {
    expect(pagesUsedBy([{ glyph: 'a', glyphPage: 1 }, { arabic: 'x' } as never])).toEqual([1]);
  });
});

describe('canDrawAsMushaf', () => {
  it('needs every word, since a hole would show as a blank', () => {
    expect(canDrawAsMushaf([{ glyph: 'a', glyphPage: 1 }, { glyph: 'b', glyphPage: 1 }])).toBe(true);
    expect(canDrawAsMushaf([{ glyph: 'a', glyphPage: 1 }, {}])).toBe(false);
    expect(canDrawAsMushaf([])).toBe(false);
  });
});

describe('page font addressing', () => {
  it('names one family and one file per page', () => {
    expect(qpcPageFamily(205)).toBe('qpc-p205');
    expect(qpcPageUrl(205)).toBe('/fonts/qcf/p205.woff2');
  });
});

describe('mushafCaption', () => {
  const page = (n: number) => ({ glyph: `g${n}`, glyphPage: n });

  it('draws the page glyphs when one page covers the caption', () => {
    expect(mushafCaption([page(205), page(205)], QPC_V2))
      .toEqual({ text: 'g205 g205', family: 'qpc-p205' });
  });

  it('leaves out the words the reader excluded', () => {
    expect(mushafCaption(
      [page(205), { ...page(205), glyph: 'gone', excluded: true }], QPC_V2
    )?.text).toBe('g205');
  });

  it('falls back when the caption straddles a page break', () => {
    // Two families cannot both be the one `ctx.font`, and half a caption drawn
    // from the wrong page would be somebody else's words.
    expect(mushafCaption([page(205), page(206)], QPC_V2)).toBeNull();
  });

  it('falls back for a Unicode face, and when no glyphs arrived', () => {
    expect(mushafCaption([page(1)], 'DigitalKhatt')).toBeNull();
    expect(mushafCaption([{ }], QPC_V2)).toBeNull();
    expect(mushafCaption(undefined, QPC_V2)).toBeNull();
  });
});


/** A timeline word and entry, spelled as the studio's own types spell them. */
type TestWord = {
  arabic: string; translation: string;
  timestamp?: number; excluded?: boolean;
  glyph?: string; glyphPage?: number;
};
type TestVerse = { verseKey: string; words?: TestWord[] };

describe('withGlyphs', () => {
  const fetched: TestVerse[] = [{
    verseKey: '3:6',
    words: [
      { arabic: 'يَشَآءُ ۚ', translation: 'He wills', glyph: 'ﱾﱿ', glyphPage: 50 },
      { arabic: 'ٱلْحَكِيمُ', translation: 'the Wise', glyph: 'ﲀ', glyphPage: 50 }
    ]
  }];

  it('fills in the glyphs a project saved before the page fonts has none of', () => {
    // The bug this exists for: 19 saved projects named the mushaf face and
    // carried no glyphs, so every one of them drew in the Unicode fallback.
    const saved: TestVerse[] = [{
      verseKey: '3:6',
      words: [
        { arabic: 'يَشَآءُ ۚ', translation: 'He wills' },
        { arabic: 'ٱلْحَكِيمُ', translation: 'the Wise' }
      ]
    }];
    const filled = withGlyphs(saved, fetched);
    expect(filled[0].words?.map(word => word.glyph)).toEqual(['ﱾﱿ', 'ﲀ']);
    expect(canDrawAsMushaf(filled[0].words)).toBe(true);
  });

  it('keeps the saved spelling, timings and exclusions', () => {
    // This repairs how a word is drawn. It must never change what it says.
    const saved: TestVerse[] = [{
      verseKey: '3:6',
      words: [
        { arabic: 'يشاء', translation: 'mine', timestamp: 12.5, excluded: true },
        { arabic: 'ٱلْحَكِيمُ', translation: 'the Wise' }
      ]
    }];
    expect(withGlyphs(saved, fetched)[0].words?.[0]).toEqual({
      arabic: 'يشاء', translation: 'mine', timestamp: 12.5, excluded: true,
      glyph: 'ﱾﱿ', glyphPage: 50
    });
  });

  it('takes the whole word list when the timeline has none', () => {
    // The opening sample: ayah text and timings, no words at all.
    const sample: TestVerse[] = [{ verseKey: '3:6' }];
    expect(withGlyphs(sample, fetched)[0].words).toEqual(fetched[0].words);
  });

});

describe('withGlyphs, when it should not act', () => {
  const fetched: TestVerse[] = [{
    verseKey: '3:6',
    words: [
      { arabic: 'يَشَآءُ ۚ', translation: 'He wills', glyph: 'ﱾﱿ', glyphPage: 50 },
      { arabic: 'ٱلْحَكِيمُ', translation: 'the Wise', glyph: 'ﲀ', glyphPage: 50 }
    ]
  }];

  it('does not rebuild a word list to write in glyphs the fetch lacks', () => {
    // `glyph: undefined` is not an improvement, and `projectPayload` saves the
    // timeline verbatim -- so the key would be written into the project.
    const thin: TestVerse[] = [{
      verseKey: '3:6',
      words: [{ arabic: 'a', translation: '' }, { arabic: 'b', translation: '' }]
    }];
    const partial: TestVerse[] = [{
      verseKey: '3:6',
      words: [{ arabic: 'a', translation: '' }, { arabic: 'b', translation: '' }]
    }];
    expect(withGlyphs(partial, thin)).toBe(partial);
  });

  it('leaves an ayah alone rather than pair its words off by one', () => {
    // A count that no longer matches means the upstream re-split the ayah.
    // Pairing by index anyway would put every glyph under the wrong word.
    const saved: TestVerse[] = [
      { verseKey: '3:6', words: [{ arabic: 'يَشَآءُ ۚ', translation: '' }] }
    ];
    expect(withGlyphs(saved, fetched)).toBe(saved);
  });

  it('returns the same array when there is nothing to fill', () => {
    // The caller runs this from an effect that also reads the timeline, so a
    // new array on every pass would loop.
    const already: TestVerse[] = [{ verseKey: '3:6', words: fetched[0].words }];
    expect(withGlyphs(already, fetched)).toBe(already);
    // An ayah the fetch did not cover is the same case.
    const elsewhere: TestVerse[] = [
      { verseKey: '9:1', words: [{ arabic: 'بَرَآءَةٌ', translation: '' }] }
    ];
    expect(withGlyphs(elsewhere, fetched)).toBe(elsewhere);
  });
});

describe('wrapCaption', () => {
  /** One unit per character, so a limit reads as "this many characters". */
  const perChar = (line: string) => line.length;

  it('wraps greedily and drops nothing', () => {
    expect(wrapCaption('alpha beta gamma delta', 12, perChar))
      .toEqual(['alpha beta', 'gamma delta']);
  });

  it('gives a token too wide for the line a line of its own', () => {
    // The caller shrinks the type until even this fits. It is never cut.
    expect(wrapCaption('a enormousword b', 5, perChar))
      .toEqual(['a', 'enormousword', 'b']);
  });

  it('never starts a line with a free-standing waqf mark', () => {
    // `ۖ` is a combining mark with no width. Broken onto the next line it
    // would be drawn over that line's first word, marking a stop the mushaf
    // does not mark. It stays with the word it was written after, however
    // far that puts the line over the limit.
    const lines = wrapCaption('وَأُخَرُ مُتَشَـٰبِهَـٰتٌ ۖ فَأَمَّا', 20, perChar);
    expect(lines.every(line => !/^[\u06D6-\u06DC]/.test(line))).toBe(true);
    expect(lines.find(line => line.includes('\u06D6'))).toMatch(/مُتَشَـٰبِهَـٰتٌ ۖ$/);
  });

  it('wraps a mushaf caption on every glyph, marks included', () => {
    // Page glyphs are private-use characters, so the guard above never
    // matches one and a mushaf line breaks wherever it needs to.
    // The break lands right before the word-plus-waqf pair, which the guard
    // above would have forbidden had a glyph ever matched it.
    expect(wrapCaption('\uFC91 \uFC92 \uFC93\uFC94 \uFC95', 3, perChar))
      .toEqual(['\uFC91 \uFC92', '\uFC93\uFC94', '\uFC95']);
  });
});

describe('mushafRows', () => {
  /** A word printed on `page`, line `line`, as the glyph `g`. */
  const at = (g: string, page: number, line: number, excluded = false) =>
    ({ glyph: g, glyphPage: page, glyphLine: line, excluded });

  it('breaks the caption where the printed page breaks it', () => {
    // Al-Baqarah 2:2 as quran.com sends it: six words on line 3, one on line 4.
    const words = [at('a', 2, 3), at('b', 2, 3), at('c', 2, 3), at('d', 2, 4)];
    expect(mushafRows(words, QPC_V2)).toEqual([
      { text: 'a b c', family: qpcPageFamily(2) },
      { text: 'd', family: qpcPageFamily(2) }
    ]);
  });

  it('draws a caption across a page break, one page per row', () => {
    // The case `mushafCaption` has to refuse: one family cannot draw both.
    const words = [at('x', 49, 15), at('y', 50, 1)];
    expect(mushafCaption(words, QPC_V2)).toBeNull();
    expect(mushafRows(words, QPC_V2)?.map(row => row.family)).toEqual([qpcPageFamily(49), qpcPageFamily(50)]);
  });

  it('leaves hidden words out, joining what is left of a line', () => {
    const words = [at('a', 2, 3), at('b', 2, 3, true), at('c', 2, 3)];
    expect(mushafRows(words, QPC_V2)?.map(row => row.text)).toEqual(['a c']);
  });

  it('declines when a word lacks its line, or another face is chosen', () => {
    expect(mushafRows([at('a', 2, 3), { glyph: 'b', glyphPage: 2 }], QPC_V2)).toBeNull();
    expect(mushafRows([at('a', 2, 3)], 'DigitalKhatt')).toBeNull();
  });
});

describe('withGlyphs, for the printed line', () => {
  it('fills in the line that a saved project stored its words without', () => {
    type Word = { glyph?: string; glyphPage?: number; glyphLine?: number };
    const saved: { verseKey: string; words: Word[] }[] = [
      { verseKey: '2:2', words: [{ glyph: 'a', glyphPage: 2 }, { glyph: 'b', glyphPage: 2 }] }
    ];
    const fetched: { verseKey: string; words: Word[] }[] = [
      { verseKey: '2:2', words: [{ glyph: 'a', glyphPage: 2, glyphLine: 3 }, { glyph: 'b', glyphPage: 2, glyphLine: 4 }] }
    ];
    expect(withGlyphs(saved, fetched)[0].words?.map(word => word.glyphLine)).toEqual([3, 4]);
  });

  it('comes back by identity once every word has its line', () => {
    const complete = [{ verseKey: '2:2', words: [{ glyph: 'a', glyphPage: 2, glyphLine: 3 }] }];
    expect(withGlyphs(complete, complete)).toBe(complete);
  });
});
