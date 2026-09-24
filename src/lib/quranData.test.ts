import { describe, it, expect } from 'vitest';
import { FONTS_ARABIC, arabicFontFamily, resolveArabicFont, FONT_ARABIC_DEFAULT, usableArabicFont, FONT_ARABIC_BUILTIN } from './quranData';

describe('arabicFontFamily', () => {
  it('gives every face its own family, not the same one', () => {
    // The bug this replaces: `ctx.font` was given the font *id*, which names no
    // family, so canvas fell through to the next entry in the list and drew all
    // four Unicode faces as Digital Khatt. Picking a font changed nothing.
    const unicode = FONTS_ARABIC.filter(font => !font.mushaf);
    const families = unicode.map(font => arabicFontFamily(font.id));
    expect(new Set(families).size).toBe(unicode.length);
  });

  it('never answers with the id itself unless the font really is named that', () => {
    expect(arabicFontFamily('DigitalKhatt')).toBe('DigitalKhatt New Madina');
    expect(arabicFontFamily('IndopakNastaleeq')).toBe('AlQuran IndoPak by QuranWBW');
  });

  it('falls back for an id nothing declares, rather than naming nothing', () => {
    // A project saved before the Google faces were removed still names one.
    expect(arabicFontFamily('Scheherazade New')).toBe('DigitalKhatt New Madina');
    expect(arabicFontFamily(undefined)).toBe('DigitalKhatt New Madina');
  });
});

describe('resolveArabicFont', () => {
  it('keeps an id the picker still offers', () => {
    for (const font of FONTS_ARABIC) expect(resolveArabicFont(font.id)).toBe(font.id);
  });

  it('moves a retired id to the mushaf', () => {
    for (const retired of ['Amiri', 'Scheherazade New', 'Noto Naskh Arabic', 'Reem Kufi', 'Aref Ruqaa']) {
      expect(resolveArabicFont(retired)).toBe(FONT_ARABIC_DEFAULT);
    }
    expect(resolveArabicFont(undefined)).toBe(FONT_ARABIC_DEFAULT);
  });
});

describe('usableArabicFont', () => {
  it('draws the chosen face when this installation has it', () => {
    expect(usableArabicFont('qpc-v2', new Set())).toBe('qpc-v2');
  });

  it('falls back to the built-in face when the chosen one is not installed', () => {
    // A fresh server has no public/fonts/, and the mushaf face then drew
    // page glyphs with no page font behind them: rows of empty boxes.
    expect(usableArabicFont('qpc-v2', new Set(['qpc-v2', 'DigitalKhatt']))).toBe(FONT_ARABIC_BUILTIN);
  });

  it('resolves a retired face before checking, and never marks the built-in face missing', () => {
    expect(usableArabicFont('Amiri', new Set(['qpc-v2']))).toBe(FONT_ARABIC_BUILTIN);
    expect(FONTS_ARABIC.find(font => font.id === FONT_ARABIC_BUILTIN)?.file).toBeNull();
  });
});
