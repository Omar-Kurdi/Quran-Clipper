import { describe, it, expect } from 'vitest';
import { normaliseClearQuran, CLEAR_QURAN_ID, CLEAR_QURAN_NAME } from './clearQuran';

describe('The Clear Quran, as this copy stores it', () => {
  it('keeps quran.com’s id for the edition', () => {
    // The id names the edition, not where the bytes came from -- so a project
    // saved now still means this translation if the Foundation later serves it.
    expect(CLEAR_QURAN_ID).toBe('131');
    expect(CLEAR_QURAN_NAME).toContain('Khattab');
  });

  it('turns the ornate half brackets into ones every font has', () => {
    // Measured: U+02F9 and U+02FA are tofu in Inter, Amiri and the system
    // default, and this is the studio's own sample verse.
    expect(normaliseClearQuran('You ˹alone˺ we worship')).toBe('You [alone] we worship');
  });

  it('leaves the words inside the brackets alone', () => {
    const out = normaliseClearQuran('˹We destroyed˺ ’Ȃd, Thamûd');
    expect(out).toContain('We destroyed');
    expect(out).not.toContain('˹');
  });

  it('repairs the two letters this copy mangled', () => {
    // The file spells the same name both ways -- fourteen `Ȃ` beside eleven
    // `Â` -- so this is damage in the copy, not the translator's choice.
    expect(normaliseClearQuran('the people of ’Ȃd')).toBe('the people of ’Âd');
    expect(normaliseClearQuran('Ⱬul-Qarnain')).toBe('Ẓul-Qarnain');
  });

  it('lets a no-break space break, so a long line still wraps', () => {
    expect(normaliseClearQuran('who believe in the unseen, establish prayer'))
      .toBe('who believe in the unseen, establish prayer');
  });

  it('leaves the characters that render perfectly well', () => {
    // Em dashes, curly quotes and the transliteration diacritics all have
    // glyphs; only what was measured as missing is touched.
    const text = 'All praise is for Allah—Lord of all worlds, “the sûrah” of Ḥā';
    expect(normaliseClearQuran(text)).toBe(text);
  });

  it('trims, since a caption is laid out from its own edges', () => {
    expect(normaliseClearQuran('  the Straight Path  ')).toBe('the Straight Path');
  });
});
