import { describe, it, expect } from 'vitest';
import {
  surahNameText, pagesUsedBy, canDrawAsMushaf, qpcPageFamily, qpcPageUrl, mushafCaption,
  QPC_V2, SURAH_NAME_FAMILY
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
