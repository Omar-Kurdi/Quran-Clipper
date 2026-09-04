import { describe, it, expect } from 'vitest';
import { buildProjectPayload, formatStoredDuration, projectTitle } from './projectPayload';
import type { VerseData } from './quranData';

const verses: VerseData[] = [
  { verseNumber: 1, verseKey: '1:1', textUthmani: 'أ', translation: '', startTime: 0, endTime: 5 },
];

const base = {
  surahNumber: 1,
  surahNameArabic: 'الفاتحة',
  surahNameEnglish: 'Al-Fatihah',
  ayahStart: 1,
  ayahEnd: 7,
  reciterId: 'sudais',
  reciterName: 'Abdul Rahman Al-Sudais',
  audioUrl: 'https://example.test/001.mp3',
  audioDurationSeconds: 125,
  verses,
  config: { aspectRatio: '9:16', textColor: '#fff', fps: 60 },
};

describe('formatStoredDuration', () => {
  it('writes minutes and zero-padded seconds', () => {
    expect(formatStoredDuration(125)).toBe('2:05');
  });

  it('is 0:00 rather than NaN for a duration that never loaded', () => {
    expect(formatStoredDuration(NaN)).toBe('0:00');
    expect(formatStoredDuration(-1)).toBe('0:00');
  });
});

describe('projectTitle', () => {
  it('names the surah and the range', () => {
    expect(projectTitle('Al-Fatihah', 1, 1, 7)).toBe('Al-Fatihah (1:1-7) Clip');
  });
});

describe('buildProjectPayload', () => {
  it('carries the identity of the project', () => {
    const payload = buildProjectPayload(base);
    expect(payload.surahNumber).toBe(1);
    expect(payload.ayahStart).toBe(1);
    expect(payload.title).toBe('Al-Fatihah (1:1-7) Clip');
    expect(payload.audioDuration).toBe('2:05');
  });

  it('stores every styling field verbatim', () => {
    const payload = buildProjectPayload(base);
    expect(payload.aspectRatio).toBe('9:16');
    expect(payload.textColor).toBe('#fff');
    expect(payload.fps).toBe(60);
  });

  it('stores the timeline as versesJson', () => {
    expect(buildProjectPayload(base).versesJson).toEqual(verses);
  });

  it('never lets a styling field shadow the project identity', () => {
    // Config is spread first for exactly this reason: a knob named `title` or
    // `surahNumber` must not be able to rename the project it belongs to.
    const payload = buildProjectPayload({
      ...base,
      config: { ...base.config, title: 'hijacked', surahNumber: 99, versesJson: [] },
    });
    expect(payload.title).toBe('Al-Fatihah (1:1-7) Clip');
    expect(payload.surahNumber).toBe(1);
    expect(payload.versesJson).toEqual(verses);
  });
});
