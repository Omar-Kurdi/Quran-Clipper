import { describe, it, expect } from 'vitest';
import { referenceToken } from './forcedAligner';

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
