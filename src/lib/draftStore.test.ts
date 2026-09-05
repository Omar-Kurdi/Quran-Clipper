import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseData } from './quranData';
import { buildDraft, saveDraft, readDraft, clearDraft, DRAFT_KEY } from './draftStore';

const store: Record<string, string> = {};
let refuse = false;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  refuse = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      if (refuse) throw new Error('QuotaExceededError');
      store[k] = v;
    },
    removeItem: (k: string) => { delete store[k]; }
  });
});

const verse = (key: string): VerseData => ({
  verseNumber: 1,
  verseKey: key,
  textUthmani: 'بِسْمِ',
  translation: 'In the name',
  startTime: 0,
  endTime: 2
});

const input = (overrides: Partial<Parameters<typeof buildDraft>[0]> = {}) => ({
  surahNumber: 23,
  surahNameArabic: 'المؤمنون',
  surahNameEnglish: "Al-Mu'minun",
  ayahStart: 93,
  ayahEnd: 96,
  reciterId: 'sudais',
  audioUrl: 'https://example.test/023.mp3',
  audioUploadName: '',
  verses: [verse('23:93')],
  config: { bgType: 'video', bgUrl: 'https://example.test/clip.mp4' },
  savedAt: 1_700_000_000_000,
  ...overrides
});

describe('draftStore', () => {
  it('round-trips a project through storage', () => {
    const draft = buildDraft(input());
    expect(saveDraft(draft)).toBe('saved');
    expect(readDraft()).toEqual(draft);
  });

  it('reports nothing when nothing was ever saved', () => {
    expect(readDraft()).toBeNull();
  });

  it('discards a draft written by a different version', () => {
    store[DRAFT_KEY] = JSON.stringify({ ...buildDraft(input()), version: 99 });
    expect(readDraft()).toBeNull();
  });

  it('discards anything unparseable rather than throwing', () => {
    store[DRAFT_KEY] = 'not json';
    expect(readDraft()).toBeNull();
  });

  it('keeps the uploaded file name but not its dead url', () => {
    const draft = buildDraft(input({ audioUrl: 'blob:http://localhost/abc', audioUploadName: 'test4.mp3' }));
    // The url would be dead on the next page load; the name says what to pick.
    expect(draft.audioUrl).toBe('');
    expect(draft.audioUploadName).toBe('test4.mp3');
  });

  it('drops uploaded backgrounds and counts them', () => {
    const draft = buildDraft(input({
      config: {
        bgType: 'video',
        bgUrl: 'blob:http://localhost/one',
        bgUrls: ['blob:http://localhost/one', 'https://example.test/keep.mp4'],
        bgSegments: [
          { url: 'blob:http://localhost/one', start: 0, end: 4 },
          { url: 'https://example.test/keep.mp4', start: 4, end: 9 }
        ]
      }
    }));

    expect(draft.config.bgUrl).toBe('');
    expect(draft.config.bgUrls).toEqual(['https://example.test/keep.mp4']);
    expect(draft.config.bgSegments).toEqual([{ url: 'https://example.test/keep.mp4', start: 4, end: 9 }]);
    expect(draft.droppedBackgrounds).toBe(3);
  });

  it('leaves a project of links completely alone', () => {
    const draft = buildDraft(input());
    expect(draft.droppedBackgrounds).toBe(0);
    expect(draft.config.bgUrl).toBe('https://example.test/clip.mp4');
    expect(draft.audioUrl).toBe('https://example.test/023.mp3');
  });

  it('says when storage refused the write instead of throwing', () => {
    refuse = true;
    expect(saveDraft(buildDraft(input()))).toBe('blocked');
  });

  it('clears what it stored', () => {
    saveDraft(buildDraft(input()));
    clearDraft();
    expect(readDraft()).toBeNull();
  });
});
