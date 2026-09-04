import { describe, it, expect } from 'vitest';
import { normalizeArabic } from './arabic';

describe('normalizeArabic', () => {
  it('strips harakat so vocalised and bare text compare equal', () => {
    expect(normalizeArabic('مُحَمَّدٌ')).toBe(normalizeArabic('محمد'));
  });

  it('folds the alef variants onto one letter', () => {
    expect(normalizeArabic('إسلام')).toBe(normalizeArabic('اسلام'));
    expect(normalizeArabic('ٱللَّه')).toBe(normalizeArabic('الله'));
  });

  it('folds ta-marbuta to ha, and alef-maqsura to ya', () => {
    expect(normalizeArabic('رحمة')).toBe(normalizeArabic('رحمه'));
    expect(normalizeArabic('موسى')).toBe(normalizeArabic('موسي'));
  });

  it('drops the mushaf marks that carry no letter', () => {
    expect(normalizeArabic('رِزْقًا ۚ')).toBe(normalizeArabic('رزقا'));
  });

  it('is safe on empty input', () => {
    expect(normalizeArabic()).toBe('');
  });
});
