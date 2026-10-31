import { describe, it, expect } from 'vitest';
import { groupedTafsir } from './tafsirTexts';
import { sharedTafsirKeys, shownTafsir } from './tafsirName';
import { setTafsirText } from './verseEdits';
import type { VerseData } from './quranData';

const caption = (verseKey: string, extra: Partial<VerseData> = {}): VerseData => ({
  verseNumber: Number(verseKey.split(':')[1]),
  verseKey,
  textUthmani: '',
  translation: '',
  startTime: 0,
  endTime: 1,
  ...extra,
});

describe('groupedTafsir', () => {
  // Al-Mulk as the chapter listing gives it: 20-21 and 25-26 each once, under the first.
  const listing = new Map([[19, 'a'], [20, 'b'], [22, 'c'], [25, 'd'], [27, 'e'], [30, 'f']]);

  it('gives an ayah with no entry of its own the group it is explained in', () => {
    const texts = groupedTafsir(67, 19, 30, listing);
    expect(texts['67:21']).toBe('b');
    expect(texts['67:26']).toBe('d');
    expect(texts['67:23']).toBe('c');
  });

  it('fills a passage that starts inside a group', () => {
    expect(groupedTafsir(67, 21, 21, listing)).toEqual({ '67:21': 'b' });
  });

  it('stops at the surah end', () => {
    expect(Object.keys(groupedTafsir(67, 29, 286, listing))).toEqual(['67:29', '67:30']);
  });
});

describe('sharedTafsirKeys', () => {
  const texts = { '67:19': 'a', '67:20': 'b', '67:21': 'b', '67:22': 'c' };

  it('is the run of ayahs with the same text', () => {
    expect(sharedTafsirKeys(texts, '67:21')).toEqual(['67:20', '67:21']);
    expect(sharedTafsirKeys(texts, '67:20')).toEqual(['67:20', '67:21']);
  });

  it('is the ayah alone when it stands alone', () => {
    expect(sharedTafsirKeys(texts, '67:22')).toEqual(['67:22']);
  });
});

describe('setTafsirText', () => {
  const verses = [caption('67:20'), caption('67:21'), caption('67:21'), caption('67:22')];

  it('edits every caption of every ayah in the group, and no other', () => {
    const edited = setTafsirText(verses, ['67:20', '67:21'], 'b', 'mine');
    expect(edited.map(verse => verse.displayTafsir)).toEqual(['mine', 'mine', 'mine', undefined]);
  });

  it('drops the edit when the text is typed back to what was fetched', () => {
    const edited = setTafsirText(verses, ['67:20', '67:21'], 'b', 'mine');
    const restored = setTafsirText(edited, ['67:20', '67:21'], 'b', 'b');
    expect(restored.every(verse => !('displayTafsir' in verse))).toBe(true);
  });

  it('keeps an emptied tafsir as an edit, which hides it', () => {
    expect(setTafsirText(verses, ['67:22'], 'c', '')[3].displayTafsir).toBe('');
  });

  it('returns the timeline by identity when nothing changes', () => {
    expect(setTafsirText(verses, ['67:22'], 'c', 'c')).toBe(verses);
  });
});

describe('shownTafsir', () => {
  it('shows an edit on a caption of the ayah added after it', () => {
    const verses = [caption('67:21', { displayTafsir: 'mine' }), caption('67:21')];
    expect(shownTafsir(verses, { '67:21': 'b' }, '67:21')).toBe('mine');
  });

  it('is the fetched text when nothing is edited', () => {
    expect(shownTafsir([caption('67:21')], { '67:21': 'b' }, '67:21')).toBe('b');
  });
});
