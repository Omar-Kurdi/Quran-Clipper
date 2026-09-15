import { describe, it, expect } from 'vitest';
import { pairVerseWords, splitVerseWords } from './verseSpelling';

// Real text from api.quran.com, verse-level field and word list side by side.
const TWO_TWO = {
  verse: 'ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ',
  words: ['ذَٰلِكَ', 'ٱلْكِتَـٰبُ', 'لَا', 'رَيْبَ ۛ', 'فِيهِ ۛ', 'هُدًۭى', 'لِّلْمُتَّقِينَ']
};

describe('splitVerseWords', () => {
  it('glues a waqf mark onto the word before it, as the word list does', () => {
    expect(splitVerseWords(TWO_TWO.verse)).toHaveLength(TWO_TWO.words.length);
    expect(splitVerseWords('رَيْبَ ۛ فِيهِ')).toEqual(['رَيْبَ ۛ', 'فِيهِ']);
  });

  it('puts a mark that opens the verse onto the word after it', () => {
    // 199 verses open with the hizb mark. Counting it as a word of its own
    // puts every index in those verses one too high.
    expect(splitVerseWords('۞ وَإِذِ ٱبْتَلَىٰٓ')).toEqual(['۞ وَإِذِ', 'ٱبْتَلَىٰٓ']);
  });
});

describe('pairVerseWords', () => {
  it('gives the verse-level spelling, not the word list entry', () => {
    // The word list writes this tanwin with the small meem; the mushaf does not.
    expect(pairVerseWords(TWO_TWO.words, TWO_TWO.verse)).toEqual([
      'ذَٰلِكَ', 'ٱلْكِتَـٰبُ', 'لَا', 'رَيْبَ ۛ', 'فِيهِ ۛ', 'هُدًى', 'لِّلْمُتَّقِينَ'
    ]);
  });

  it('returns one entry per word in the list, so no index moves', () => {
    const paired = pairVerseWords(TWO_TWO.words, TWO_TWO.verse);
    expect(paired).toHaveLength(TWO_TWO.words.length);
  });

  it('lets one entry span two written words', () => {
    // 37:130. The verse writes إِلْ يَاسِينَ as two tokens; the list has one entry.
    expect(pairVerseWords(['سَلَـٰمٌ', 'عَلَىٰٓ', 'إِلْ يَاسِينَ'], 'سَلَـٰمٌ عَلَىٰٓ إِلْ يَاسِينَ'))
      .toEqual(['سَلَـٰمٌ', 'عَلَىٰٓ', 'إِلْ يَاسِينَ']);
  });

  it('pairs the one word the list spells with a different letter', () => {
    // 11:13, the only verse in the Quran that needs the second pass: the list
    // writes ٱفْتَرَىٰهُ with a plain alef for the long a.
    const paired = pairVerseWords(
      ['أَمْ', 'يَقُولُونَ', 'افْتَرَاهُ ۖ', 'قُلْ'],
      'أَمْ يَقُولُونَ ٱفْتَرَىٰهُ ۖ قُلْ'
    );
    expect(paired).toEqual(['أَمْ', 'يَقُولُونَ', 'ٱفْتَرَىٰهُ ۖ', 'قُلْ']);
  });

  it('refuses rather than pairing a word list against the wrong verse', () => {
    // Half a pairing is worse than none: every following index would be off.
    expect(pairVerseWords(['قُلْ', 'هُوَ', 'ٱللَّهُ', 'أَحَدٌ'], 'ذَٰلِكَ ٱلْكِتَـٰبُ')).toBeNull();
  });

  it('refuses when the verse has words the list does not', () => {
    expect(pairVerseWords(['قُلْ', 'هُوَ'], 'قُلْ هُوَ ٱللَّهُ أَحَدٌ')).toBeNull();
  });
});
