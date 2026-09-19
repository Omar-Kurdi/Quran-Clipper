import { describe, it, expect } from 'vitest';
import type { MatchSegment } from './matchTypes';
import { phrasesFromPublished, timedFromPublished } from './publishedPhrases';

/** Muaiqly's 12:3 and 12:6 as QUL publishes them -- 12:6 goes back over words 8-10. */
const published = new Map([
  ['12:3', {
    from: 35380, to: 56960,
    segments: [[1, 35680, 36260], [2, 36260, 37030], [3, 37030, 37720], [4, 37780, 38620], [5, 38620, 39360],
      [6, 39480, 42100], [7, 42100, 44710], [8, 44710, 45390], [9, 45490, 46190], [10, 46190, 47430],
      [11, 47430, 49040], [12, 49040, 50700], [13, 50700, 51930], [14, 51930, 53150], [15, 53150, 53550],
      [16, 53550, 56960]],
  }],
  ['12:6', {
    from: 100040, to: 143810,
    segments: [[1, 100040, 101200], [2, 101280, 102420], [3, 102540, 103260], [4, 103340, 104650],
      [5, 104770, 106200], [6, 106200, 107210], [7, 107230, 108660], [8, 108660, 110510], [9, 110510, 111710],
      [10, 111710, 115090], [8, 115090, 116720], [9, 116720, 117930], [10, 117930, 118640], [11, 118700, 121270],
      [12, 121270, 121900], [13, 121900, 122950], [14, 122950, 123430], [15, 125150, 127270], [16, 127270, 129040],
      [17, 129040, 129990], [18, 130070, 131070], [19, 131090, 131740], [20, 131740, 133150], [21, 133150, 137190],
      [22, 137190, 139180], [23, 139180, 139860], [24, 139920, 140990], [25, 140990, 143810]],
  }],
]);
const passage = [{ verseKey: '12:3', wordCount: 16 }, { verseKey: '12:6', wordCount: 25 }];

const seg = (verseKey: string, from: number, to: number, startTime: number, endTime: number): MatchSegment =>
  ({ verseKey, startWordIndex: from, endWordIndex: to, startTime, endTime });

/** What the aligner made of that recording: 12:4's لِى where 12:3's عَلَيْكَ is. */
const aligned = [
  seg('12:3', 0, 1, 35.6, 37.2),
  seg('12:4', 12, 12, 37.2, 37.8),
  seg('12:3', 3, 15, 37.8, 58.1),
  seg('12:6', 0, 9, 100, 114.3),
  seg('12:6', 7, 20, 114.3, 136.4),
  seg('12:6', 21, 24, 136.4, 145.1),
];

const words = (caption: MatchSegment) => [caption.verseKey, caption.startWordIndex, caption.endWordIndex];

describe('phrasesFromPublished', () => {
  it('keeps an ayah recited in one breath whole, whatever the aligner put in the middle of it', () => {
    const captions = phrasesFromPublished(passage, published, aligned)!;
    const ayah3 = captions.filter(caption => caption.verseKey === '12:3');
    expect(ayah3.map(words)).toEqual([['12:3', 0, 15]]);
    expect(ayah3[0]).toMatchObject({ startTime: 35.38, endTime: 56.96 });
    // Nothing from 12:4 is shown, because 12:4 was not asked for.
    expect(captions.some(caption => caption.verseKey === '12:4')).toBe(false);
  });

  it('starts again where the reciter went back, and cuts where the aligner heard a pause', () => {
    const ayah6 = phrasesFromPublished(passage, published, aligned)!.filter(caption => caption.verseKey === '12:6');
    expect(ayah6.map(words)).toEqual([['12:6', 0, 9], ['12:6', 7, 20], ['12:6', 21, 24]]);
    expect(ayah6.map(caption => [caption.startTime, caption.endTime])).toEqual([[100.04, 115.09], [115.09, 137.19], [137.19, 143.81]]);
    expect(ayah6[1].notes).toBe('restarted phrase');
    // The repeat carries the times of its own reading, not the first one's.
    expect(ayah6[1].wordTimings?.[0]).toEqual({ index: 7, start: 115.09, end: 116.72 });
  });

  it('ignores a cut nowhere near where the published timings put that boundary', () => {
    const far = [seg('12:3', 0, 4, 35.6, 45), seg('12:3', 5, 15, 45, 58)];
    expect(phrasesFromPublished(passage.slice(0, 1), published, far)!.map(words)).toEqual([['12:3', 0, 15]]);
    const near = [seg('12:3', 0, 4, 35.6, 39.3), seg('12:3', 5, 15, 39.3, 58)];
    expect(phrasesFromPublished(passage.slice(0, 1), published, near)!.map(words)).toEqual([['12:3', 0, 4], ['12:3', 5, 15]]);
  });

  it('shows every word even where the timings skip one, and still works with no aligner at all', () => {
    const gappy = new Map([['12:3', { from: 35380, to: 56960, segments: [[2, 36260, 37030], [5, 38620, 39360]] }]]);
    expect(phrasesFromPublished(passage.slice(0, 1), gappy, [])!.map(words)).toEqual([['12:3', 0, 15]]);
    const boundsOnly = new Map([['12:3', { from: 35380, to: 56960 }]]);
    expect(phrasesFromPublished(passage.slice(0, 1), boundsOnly, [])).toEqual([
      { verseKey: '12:3', surahNumber: 12, verseNumber: 3, confidence: 1, startTime: 35.38, endTime: 56.96, startWordIndex: 0, endWordIndex: 15 },
    ]);
  });

  it('reads a word listed twice in a row as one long word, not a repeat', () => {
    // Muaiqly's 2:128 as QUL publishes it: the last word, held, in three pieces.
    const held = new Map([['2:128', { from: 0, to: 9000, segments: [[1, 0, 2000], [16, 2000, 3000], [17, 3000, 4670], [17, 4670, 5800], [17, 5800, 8110]] }]]);
    const captions = phrasesFromPublished([{ verseKey: '2:128', wordCount: 17 }], held, [])!;
    expect(captions.map(words)).toEqual([['2:128', 0, 16]]);
    expect(captions[0].wordTimings?.at(-1)).toEqual({ index: 16, start: 3, end: 8.11 });
  });

  it('refuses a passage it cannot time completely', () => {
    expect(phrasesFromPublished([...passage, { verseKey: '12:7', wordCount: 7 }], published, aligned)).toBeNull();
  });
});

describe('timedFromPublished', () => {
  const muaiqly = { provider: 'qul', passage, timings: published };

  it('takes the pauses from an aligner that is sure of itself, and says so', () => {
    const { result, pausesFromAudio } = timedFromPublished(muaiqly, { segments: aligned, audioDuration: 150 });
    expect(pausesFromAudio).toBe(true);
    expect(result.audioDuration).toBe(150);
    expect(result.segments.every(caption => caption.confidence === 1)).toBe(true);
  });

  it('keeps one caption per ayah when the aligner doubted its result or did not run', () => {
    for (const doubted of [{ segments: aligned, warning: 'low coverage' }, { segments: [] }]) {
      const { result, pausesFromAudio } = timedFromPublished(muaiqly, doubted);
      expect(pausesFromAudio).toBe(false);
      // 12:6 still starts again where the reciter went back; nothing else is cut.
      expect(result.segments.map(words)).toEqual([['12:3', 0, 15], ['12:6', 0, 9], ['12:6', 7, 24]]);
    }
  });

  it('leaves the aligner\u2019s result alone when the timings do not cover the passage', () => {
    const partial = { ...muaiqly, passage: [...passage, { verseKey: '12:7', wordCount: 7 }] };
    const aligner = { segments: aligned, notes: 'aligned' };
    expect(timedFromPublished(partial, aligner)).toEqual({ result: aligner, pausesFromAudio: false });
  });
});
