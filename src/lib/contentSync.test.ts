import { describe, it, expect } from 'vitest';
import { applyContentSync, needsContentSync, CONTENT_SYNC_MAX_AGE_MS } from './contentSync';
import type { VerseData } from './quranData';
import type { CorpusVerse } from './quranCorpus';

const DAY = 24 * 60 * 60 * 1000;

/** What the upstream serves for 1:2 today. */
const current: CorpusVerse = {
  surahNumber: 1,
  verseNumber: 2,
  verseKey: '1:2',
  textUthmani: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ',
  translation: '[All] praise is [due] to Allah',
  words: [
    { arabic: 'ٱلْحَمْدُ', translation: 'All praises', glyph: 'a', glyphPage: 1 },
    { arabic: 'لِلَّهِ', translation: '(be) to Allah', glyph: 'b', glyphPage: 1 },
    { arabic: 'رَبِّ', translation: '(the) Lord', glyph: 'c', glyphPage: 1 },
    { arabic: 'ٱلْعَـٰلَمِينَ', translation: 'of the universe', glyph: 'd', glyphPage: 1 }
  ]
};

/** A saved caption for 1:2 as it was stored some time ago. */
const stored = (overrides: Partial<VerseData> = {}): VerseData => ({
  verseNumber: 2,
  verseKey: '1:2',
  textUthmani: 'old text',
  displayTextUthmani: 'old',
  translation: 'old translation',
  startTime: 3,
  endTime: 7,
  words: [
    { arabic: 'w1', translation: 'g1', excluded: false, timestamp: 3.1 },
    { arabic: 'w2', translation: 'g2', excluded: true },
    { arabic: 'w3', translation: 'g3', excluded: false, timestamp: 4.4 },
    { arabic: 'w4', translation: 'g4', excluded: false }
  ],
  ...overrides
});

const run = (verse: VerseData, extra: Partial<Parameters<typeof applyContentSync>[0]> = {}) =>
  applyContentSync({
    verses: [verse],
    translationIds: ['20'],
    corpus: new Map([['1:2', current]]),
    texts: {},
    available: new Set(['20', '85', '158']),
    defaultId: '20',
    ...extra
  });

describe('needsContentSync', () => {
  const now = Date.UTC(2026, 8, 18);

  it('checks anything never checked', () => {
    expect(needsContentSync(null, now)).toBe(true);
    expect(needsContentSync(undefined, now)).toBe(true);
  });

  it('checks again once seven days have passed, not before', () => {
    expect(needsContentSync(now - 6 * DAY, now)).toBe(false);
    expect(needsContentSync(now - CONTENT_SYNC_MAX_AGE_MS, now)).toBe(true);
    expect(needsContentSync(new Date(now - 8 * DAY).toISOString(), now)).toBe(true);
  });
});

describe('applyContentSync', () => {
  it('replaces the stored Arabic, words, glyphs and translation with what is served now', () => {
    const [verse] = run(stored()).verses;
    expect(verse.textUthmani).toBe(current.textUthmani);
    expect(verse.translation).toBe(current.translation);
    expect(verse.words?.map(word => [word.arabic, word.translation, word.glyph])).toEqual(
      current.words.map(word => [word.arabic, word.translation, word.glyph])
    );
  });

  it('keeps the timings, the hidden words and the times of each word', () => {
    // Those are the user's work, not the upstream's content.
    const [verse] = run(stored()).verses;
    expect([verse.startTime, verse.endTime]).toEqual([3, 7]);
    expect(verse.words?.map(word => word.excluded)).toEqual([false, true, false, false]);
    expect(verse.words?.map(word => word.timestamp)).toEqual([3.1, undefined, 4.4, undefined]);
    // What is on screen follows the refreshed words, minus the hidden one.
    expect(verse.displayTextUthmani).toBe('ٱلْحَمْدُ رَبِّ ٱلْعَـٰلَمِينَ');
  });

  it('keeps a hand correction to a translation', () => {
    const [verse] = run(stored({ displayTranslation: 'mine', displayTranslations: { '85': 'also mine' } }), {
      translationIds: ['20', '85']
    }).verses;
    expect(verse.displayTranslation).toBe('mine');
    expect(verse.displayTranslations).toEqual({ '85': 'also mine' });
  });

  it('takes the word list fresh when the upstream re-split the ayah', () => {
    // Pairing by index would put every time and hidden word on the wrong word.
    const [verse] = run(stored({ words: [{ arabic: 'only', translation: '', excluded: true, timestamp: 1 }] })).verses;
    expect(verse.words).toHaveLength(4);
    expect(verse.words?.every(word => !word.excluded && word.timestamp === undefined)).toBe(true);
  });

  it('refreshes every chosen edition’s text', () => {
    const [verse] = run(stored({ translations: { '85': 'stale' } }), {
      translationIds: ['20', '85'],
      texts: { '1:2': { '85': 'current' } }
    }).verses;
    expect(verse.translations).toEqual({ '85': 'current' });
  });

});

describe('applyContentSync, when an edition is gone', () => {
  it('removes an edition nobody serves any more, with its text and corrections', () => {
    const result = run(stored({ translations: { '999': 'gone' }, displayTranslations: { '999': 'fix' } }), {
      translationIds: ['20', '999']
    });
    expect(result.translationIds).toEqual(['20']);
    expect(result.removedIds).toEqual(['999']);
    expect(result.verses[0].translations).toBeUndefined();
    expect(result.verses[0].displayTranslations).toBeUndefined();
  });

  it('falls back to the default when every chosen edition is gone', () => {
    expect(run(stored(), { translationIds: ['999'] }).translationIds).toEqual(['20']);
  });

  it('leaves an empty choice empty, which already means the default', () => {
    expect(run(stored(), { translationIds: [] }).translationIds).toEqual([]);
  });

  it('reports itself incomplete, and leaves the verse alone, when the corpus did not answer for it', () => {
    // The caller must not stamp the project as checked.
    const verse = stored();
    const result = run(verse, { corpus: new Map() });
    expect(result.complete).toBe(false);
    expect(result.verses[0]).toBe(verse);
  });
});
