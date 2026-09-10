import { describe, it, expect } from 'vitest';
import { selectPhrases, Imported } from './mutashabihat';

// Two ayahs sharing one phrase, plus a phrase that occurs only in one of them.
const data: Imported = {
  phrases: {
    p1: [
      { verseKey: '2:23', from: 15, to: 17 },
      { verseKey: '2:107', from: 11, to: 13 },
      { verseKey: '3:79', from: 16, to: 18 }
    ],
    p2: [
      { verseKey: '2:23', from: 1, to: 2 },
      { verseKey: '9:9', from: 4, to: 5 }
    ]
  },
  byVerse: {
    '2:23': [{ from: 15, to: 17, phrase: 'p1' }, { from: 1, to: 2, phrase: 'p2' }],
    '2:107': [{ from: 11, to: 13, phrase: 'p1' }],
    '3:79': [{ from: 16, to: 18, phrase: 'p1' }]
  }
};

describe('where else a passage’s words occur', () => {
  it('lists the other places, never the ayah asked about', () => {
    const [most] = selectPhrases(data, '2:23');
    expect(most.elsewhere.map(p => p.verseKey)).toEqual(['2:107', '3:79']);
  });

  it('puts the most repeated phrase first', () => {
    const found = selectPhrases(data, '2:23');
    expect(found.map(p => p.elsewhere.length)).toEqual([2, 1]);
  });

  it('narrows to the words a caption is actually showing', () => {
    // A caption over the front of the ayah should not be warned about a repeat
    // in the half it is not displaying.
    const front = selectPhrases(data, '2:23', { from: 1, to: 3 });
    expect(front).toHaveLength(1);
    expect(front[0].from).toBe(1);
  });

  it('counts a range that merely overlaps, since part of the phrase is shown', () => {
    expect(selectPhrases(data, '2:23', { from: 16, to: 20 })).toHaveLength(1);
    expect(selectPhrases(data, '2:23', { from: 4, to: 14 })).toHaveLength(0);
  });

  it('says nothing about an ayah with no repeated phrase', () => {
    expect(selectPhrases(data, '9:9')).toEqual([]);
  });

  it('says nothing at all when the export is not on this machine', () => {
    expect(selectPhrases(null, '2:23')).toEqual([]);
  });
});
