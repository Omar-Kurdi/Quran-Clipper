import { describe, it, expect } from 'vitest';
import { asBadgeStyle, usableBadgeStyle, badgeRange, badgeSurah, SURAH_NAME_FONT_ID } from './surahBadge';

describe('asBadgeStyle', () => {
  it('reads anything unknown, and every older project, as the pill', () => {
    expect(asBadgeStyle(undefined)).toBe('pill');
    expect(asBadgeStyle('none')).toBe('pill');
    expect(asBadgeStyle('frame')).toBe('frame');
  });
});

describe('usableBadgeStyle', () => {
  it('draws the pill when the calligraphic face is not installed', () => {
    expect(usableBadgeStyle('calligraphic', new Set([SURAH_NAME_FONT_ID]))).toBe('pill');
    expect(usableBadgeStyle('calligraphic', new Set())).toBe('calligraphic');
  });

  it('leaves the other styles alone when it is missing', () => {
    expect(usableBadgeStyle('corner', new Set([SURAH_NAME_FONT_ID]))).toBe('corner');
  });
});

describe('badgeRange', () => {
  const fallback = { surah: 2, start: 1, end: 5 };
  it('names one surah once', () => {
    expect(badgeRange('2:255', '2:257', fallback)).toBe('2:255-257');
  });
  it('names both ends across a surah boundary', () => {
    expect(badgeRange('2:286', '3:5', fallback)).toBe('2:286 → 3:5');
  });
  it('falls back to the selection with no verses', () => {
    expect(badgeRange(undefined, undefined, fallback)).toBe('2:1-5');
  });
});

describe('badgeSurah', () => {
  const project = { number: 2, nameArabic: 'البقرة', nameEnglish: 'Al-Baqarah' };

  it("keeps the project's own names for its own surah", () => {
    expect(badgeSurah('2:286', { ...project, nameEnglish: 'The Cow' })).toEqual({ ...project, nameEnglish: 'The Cow' });
  });

  it('names the surah being recited once a clip crosses into the next', () => {
    expect(badgeSurah('3:1', project)).toEqual({ number: 3, nameArabic: 'آل عمران', nameEnglish: "Ali 'Imran" });
  });

  it('keeps the project surah with no caption on screen', () => {
    expect(badgeSurah(undefined, project)).toBe(project);
  });
});
