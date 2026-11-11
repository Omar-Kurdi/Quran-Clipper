import { describe, it, expect } from 'vitest';
import { asBadgeStyle, usableBadgeStyle, badgeRange, badgeSurah, passageBadgeRange, SURAH_NAME_FONT_ID } from './surahBadge';

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

describe('passageBadgeRange', () => {
  const fallback = { surah: 2, start: 115, end: 149 };
  const at = (key: string, startTime: number, endTime: number) => ({ verseKey: key, startTime, endTime });
  // One recording of 2:115-149, cut into clips: every clip holds all of its captions.
  const recording = [at('2:115', 1, 9), at('2:116', 10, 18), at('2:117', 19, 25), at('2:118', 26, 40), at('2:149', 300, 310)];

  it("names only the ayahs inside a clip, not the recording's whole range", () => {
    expect(passageBadgeRange(recording, { start: 9.5, end: 25.5 }, fallback)).toBe('2:116-117');
    expect(passageBadgeRange(recording, { start: 25.5, end: 40.5 }, fallback)).toBe('2:118-118');
  });

  it('names every caption when there is no clip', () => {
    expect(passageBadgeRange(recording, null, fallback)).toBe('2:115-149');
  });

  it('starts at the first ayah, not an opening', () => {
    expect(passageBadgeRange([at('basmala', 0, 3), ...recording.slice(0, 2)], { start: 0, end: 18.5 }, fallback)).toBe('2:115-116');
  });
});
