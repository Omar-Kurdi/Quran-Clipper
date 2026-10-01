import { describe, it, expect } from 'vitest';
import { drawnWordTimes, fillLineByWord } from './arabicWords';
import type { TextCanvas } from './waqfMarks';

describe('drawnWordTimes', () => {
  it('gives each drawn word its time, line by line', () => {
    const words = [
      { arabic: 'بِسْمِ', timestamp: 1 },
      { arabic: 'ٱللَّهِ', timestamp: 1.6 },
      { arabic: 'ٱلرَّحْمَـٰنِ', timestamp: 2.4 },
      { arabic: 'ٱلرَّحِيمِ', timestamp: 3.5 },
    ];
    expect(drawnWordTimes(words, ['بِسْمِ ٱللَّهِ', 'ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ'])).toEqual([[1, 1.6], [2.4, 3.5]]);
  });

  it('counts a waqf sign joined to its word as part of that word', () => {
    // `wrapCaption` draws the sign with no space before it, so two entries of
    // the word list are one drawn word.
    const words = [
      { arabic: 'مِّنَ', timestamp: 4 },
      { arabic: 'ٱلْعَذَابِ', timestamp: 4.4 },
      { arabic: 'ۖ', timestamp: 5 },
      { arabic: 'وَلَهُمْ', timestamp: 5.6 },
    ];
    expect(drawnWordTimes(words, ['مِّنَ ٱلْعَذَابِۖ وَلَهُمْ'])).toEqual([[4, 4.4, 5.6]]);
  });

  it('leaves out the words hidden from the caption', () => {
    const words = [
      { arabic: 'قُلْ', timestamp: 1, excluded: true },
      { arabic: 'هُوَ', timestamp: 2 },
      { arabic: 'ٱللَّهُ', timestamp: 3 },
    ];
    expect(drawnWordTimes(words, ['هُوَ ٱللَّهُ'])).toEqual([[2, 3]]);
  });

});

describe('drawnWordTimes on partial or unmatched captions', () => {
  it('lines up a partial ayah whose shown words end on a waqf sign', () => {
    // As a matched caption of 3:187 hands it over: the first words hidden,
    // a sign after one of the shown words, and that sign untimed.
    const words = [
      { arabic: 'وَإِذْ', timestamp: 0.1, excluded: true },
      { arabic: 'أَخَذَ', timestamp: 0.5, excluded: true },
      { arabic: 'فَنَبَذُوهُ', timestamp: 6.2 },
      { arabic: 'وَرَآءَ', timestamp: 6.9 },
      { arabic: 'ظُهُورِهِمْ', timestamp: 7.4 },
      { arabic: 'ۖ' },
      { arabic: 'وَٱشْتَرَوْا۟', timestamp: 8.3 },
    ];
    expect(drawnWordTimes(words, ['فَنَبَذُوهُ وَرَآءَ', 'ظُهُورِهِمْۖ وَٱشْتَرَوْا۟'])).toEqual([[6.2, 6.9], [7.4, 8.3]]);
  });

  it('gives up when the drawing and the word list do not line up, or nothing is timed', () => {
    const words = [{ arabic: 'هُوَ', timestamp: 2 }, { arabic: 'ٱللَّهُ', timestamp: 3 }];
    expect(drawnWordTimes(words, ['قُلْ هُوَ ٱللَّهُ'])).toBeNull();
    expect(drawnWordTimes([{ arabic: 'هُوَ' }, { arabic: 'ٱللَّهُ' }], ['هُوَ ٱللَّهُ'])).toBeNull();
    expect(drawnWordTimes(undefined, ['هُوَ'])).toBeNull();
  });
});

describe('fillLineByWord', () => {
  /** A canvas that records what is drawn, where, and how; every character 10px wide. */
  function recorder() {
    const drawn: { text: string; x: number; alpha: number; colour: string }[] = [];
    const ctx: TextCanvas = {
      textAlign: 'center',
      globalAlpha: 1,
      fillStyle: '#ffffff',
      measureText: (text: string) => ({ width: text.length * 10, actualBoundingBoxRight: 0 }) as TextMetrics,
      fillText(text: string, x: number) {
        drawn.push({ text, x, alpha: ctx.globalAlpha, colour: String(ctx.fillStyle) });
      },
    };
    return { ctx, drawn };
  }

  it('draws each word whole and by itself, at its place in the line, so its ink stays with it', () => {
    // 40:18: the tail of ٱلْحَنَاجِرِ reaches under the next word, so a cut
    // between the two gave it to the wrong one.
    const { ctx, drawn } = recorder();
    fillLineByWord(ctx, 'aaa bb', { x: 100, y: 0, size: 40 }, word => ({ amount: 1, colour: word === 0 ? '#ef4444' : undefined }));
    // Centred at 100, the 60px line runs from 130 on the right; the second
    // word starts past the first and its space.
    expect(drawn).toEqual([
      { text: 'aaa', x: 130, alpha: 1, colour: '#ef4444' },
      { text: 'bb', x: 90, alpha: 1, colour: '#ffffff' },
    ]);
    expect(ctx.textAlign).toBe('center');
  });

  it('leaves a word not yet begun undrawn, draws one arriving faint, and the whole line when all are in', () => {
    const { ctx, drawn } = recorder();
    fillLineByWord(ctx, 'aaa bb cc', { x: 100, y: 0, size: 40 }, word => ({ amount: [1, 0.5, 0][word] }));
    expect(drawn.map(d => [d.text, d.alpha])).toEqual([['aaa', 1], ['bb', 0.5]]);
    drawn.length = 0;
    fillLineByWord(ctx, 'aaa bb cc', { x: 100, y: 0, size: 40 }, () => ({ amount: 1 }));
    expect(drawn.map(d => d.text)).toEqual(['aaa bb cc']);
  });
});
