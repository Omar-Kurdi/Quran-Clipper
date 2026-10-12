import { describe, it, expect } from 'vitest';
import { buildProjectPayload, formatStoredDuration, projectTitle, timelinePassage } from './projectPayload';
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

  it('carries the uploaded file name and the trim window', () => {
    // What makes a project built from an upload openable again: the audio
    // itself lives in the browser, but if that is gone these two can rebuild
    // the same clip from the file the user still has.
    const payload = buildProjectPayload({
      ...base,
      audioFileName: 'test4.mp3',
      audioKey: 'aud_abc',
      trimWindow: { start: 4.2, end: 41.6 },
    });
    expect(payload.audioFileName).toBe('test4.mp3');
    expect(payload.audioKey).toBe('aud_abc');
    expect(payload.trimWindow).toEqual({ start: 4.2, end: 41.6 });
  });

  it('keeps the file name for an untrimmed upload, with no window', () => {
    const payload = buildProjectPayload({ ...base, audioFileName: 'test4.mp3' });
    expect(payload.audioFileName).toBe('test4.mp3');
    expect(payload.trimWindow).toBeNull();
  });

  it('stores neither for a built-in reciter, however the studio got there', () => {
    // A session that uploaded a file, trimmed it, then went back to a reciter
    // must not save that file's name against reciter audio -- reopening would
    // ask for a file that has nothing to do with what plays.
    const payload = buildProjectPayload({
      ...base,
      audioFileName: '',
      audioKey: 'aud_abc',
      trimWindow: { start: 4.2, end: 41.6 },
    });
    expect(payload.audioFileName).toBe('');
    expect(payload.audioKey).toBe('');
    expect(payload.trimWindow).toBeNull();
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

describe('timelinePassage', () => {
  const asked = { surahNumber: 27, start: 59, end: 64 };

  it('names the ayahs left on the timeline once it is trimmed down, not the ones first loaded', () => {
    const left = [{ verseKey: '27:60' }, { verseKey: '27:61' }, { verseKey: '27:62' }];
    expect(timelinePassage(left, asked)).toEqual({ surahNumber: 27, start: 60, end: 62 });
    expect(projectTitle('An-Naml', 27, 60, 62)).toBe('An-Naml (27:60-62) Clip');
  });

  it('keeps the request where the timeline has no ayah, or ayahs of two surahs', () => {
    expect(timelinePassage([{ verseKey: 'basmala' }], asked)).toBe(asked);
    expect(timelinePassage([{ verseKey: '2:286' }, { verseKey: '3:1' }], asked)).toBe(asked);
  });
});
