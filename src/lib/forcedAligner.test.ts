import { describe, it, expect } from 'vitest';
import { referenceToken, screenBreaksFrom, alignedSegments } from './forcedAligner';
import type { CorpusVerse } from './quranCorpus';

describe('referenceToken', () => {
  it('spends one reference word per rendered word', () => {
    // The sidecar splits the reference on whitespace and the indices it
    // returns are read against the app's own word array, so a word written
    // with an internal space has to arrive as one token or everything after
    // it in that verse is captioned one place late.
    expect(referenceToken({ arabic: 'بَعْدَ مَا' }).split(/\s/)).toHaveLength(1);
    // 37:130, which the word list has always sent with its space in it.
    expect(referenceToken({ arabic: 'إِلْ يَاسِينَ' }).split(/\s/)).toHaveLength(1);
  });

  it('leaves a word that was already one token alone', () => {
    expect(referenceToken({ arabic: 'تَبَارَكَ' })).toBe('تَبَارَكَ');
  });

  it('keeps every letter, so the alignment target is unchanged', () => {
    expect(referenceToken({ arabic: 'بَعْدَ مَا' })).toBe('بَعْدَمَا');
    expect(referenceToken({ arabic: 'رَيْبَ ۛ' })).toBe('رَيْبَۛ');
  });
});

describe('screenBreaksFrom', () => {
  it('passes the two settings the sidecar knows', () => {
    expect(screenBreaksFrom('fewer')).toBe('fewer');
    expect(screenBreaksFrom('more')).toBe('more');
  });

  it('reads anything else as normal, so a stray value never reaches the sidecar', () => {
    for (const value of [null, '', 'normal', 'MORE', 'lots', 1]) expect(screenBreaksFrom(value)).toBe('normal');
  });
});

describe('alignedSegments', () => {
  // 3:195 as Abdullah_Almusa.mp3 recites it: وَقَـٰتَلُوا۟ said, then said again
  // after a stop, so the same word index appears twice with different times.
  const verse: CorpusVerse = {
    surahNumber: 3, verseNumber: 195, verseKey: '3:195', textUthmani: '', translation: '',
    words: [{ arabic: 'وَقَـٰتَلُوا۟', translation: 'and fought' }, { arabic: 'وَقُتِلُوا۟', translation: 'and were killed' }]
  };
  const word = (index: number, start: number, end: number) =>
    ({ text: '', verse_key: '3:195', word_index: index, start, end, score: 1, is_repeat: false });
  const segment = (from: number, to: number, start: number, end: number, restart = false) =>
    ({ verse_key: '3:195', start_word: from, end_word: to, start, end, score: 0.9, is_restart: restart });

  it('gives a restarted phrase the times of its own utterance, not the first one', () => {
    const [first, again] = alignedSegments(
      { words: [word(0, 182, 183), word(0, 184, 185), word(1, 185, 186)], segments: [segment(0, 0, 182, 184), segment(0, 1, 184, 186, true)] },
      [verse]
    );
    expect(first.wordTimings).toEqual([{ index: 0, start: 182, end: 183 }]);
    expect(again.wordTimings).toEqual([{ index: 0, start: 184, end: 185 }, { index: 1, start: 185, end: 186 }]);
    expect(again.notes).toBe('restarted phrase');
  });

  it("takes each caption's text from the words it covers, and leaves the translation to the ayah", () => {
    const [caption] = alignedSegments({ words: [word(1, 185, 186)], segments: [segment(1, 1, 185, 186)] }, [verse]);
    expect(caption.displayTextUthmani).toBe('وَقُتِلُوا۟');
    expect(caption.displayTranslation).toBe('');
    expect([caption.startWordIndex, caption.endWordIndex]).toEqual([1, 1]);
  });
});
