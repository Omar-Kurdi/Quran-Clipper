import { describe, it, expect } from 'vitest';
import type { MatchSegment } from './matchTypes';
import { inTheGaps, toTheVoice, phrasesFromPublished, timedFromPublished, withRepeats, goingBack } from './publishedPhrases';

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
/** The two ayahs' words as the mushaf prints them: 12:6 has a stop sign on وَإِسْحَـٰقَ ۚ, 12:3 none. */
const text12v3 = ['نَحْنُ', 'نَقُصُّ', 'عَلَيْكَ', 'أَحْسَنَ', 'ٱلْقَصَصِ', 'بِمَآ', 'أَوْحَيْنَآ', 'إِلَيْكَ', 'هَـٰذَا', 'ٱلْقُرْءَانَ', 'وَإِن', 'كُنتَ', 'مِن', 'قَبْلِهِۦ', 'لَمِنَ', 'ٱلْغَـٰفِلِينَ'];
const text12v6 = ['وَكَذَٰلِكَ', 'يَجْتَبِيكَ', 'رَبُّكَ', 'وَيُعَلِّمُكَ', 'مِن', 'تَأْوِيلِ', 'ٱلْأَحَادِيثِ', 'وَيُتِمُّ', 'نِعْمَتَهُۥ', 'عَلَيْكَ', 'وَعَلَىٰٓ', 'ءَالِ', 'يَعْقُوبَ', 'كَمَآ', 'أَتَمَّهَا', 'عَلَىٰٓ', 'أَبَوَيْكَ', 'مِن', 'قَبْلُ', 'إِبْرَٰهِيمَ', 'وَإِسْحَـٰقَ ۚ', 'إِنَّ', 'رَبَّكَ', 'عَلِيمٌ', 'حَكِيمٌ'];
const passage = [{ verseKey: '12:3', wordCount: 16, words: text12v3 }, { verseKey: '12:6', wordCount: 25, words: text12v6 }];

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

  it('starts again where the reciter went back, and cuts where the aligner heard a pause at a stop sign', () => {
    const ayah6 = phrasesFromPublished(passage, published, aligned)!.filter(caption => caption.verseKey === '12:6');
    expect(ayah6.map(words)).toEqual([['12:6', 0, 9], ['12:6', 7, 20], ['12:6', 21, 24]]);
    // A pause where the aligner heard it (136.4s), not at the published word
    // after it (137.19s): published words inside an ayah can run a second or
    // more early (Al-Muaiqly's 66:9), and a caption cut there changed while the
    // words before it were still being said.
    expect(ayah6.map(caption => [caption.startTime, caption.endTime])).toEqual([[100.04, 115.09], [115.09, 136.4], [136.4, 143.81]]);
    expect(ayah6[1].notes).toBe('restarted phrase');
    // The repeat carries the times of its own reading, not the first one's. A
    // going back stays at the published word: the aligner's times for those
    // came out a second early on Khalid al-Jalil's 12:87.
    expect(ayah6[1].wordTimings?.[0]).toEqual({ index: 7, start: 115.09, end: 116.72 });
  });

  it('ignores a cut nowhere near where the published timings put that boundary', () => {
    const marked = [{ ...passage[0], words: text12v3.map((word, i) => (i === 4 ? `${word} ۚ` : word)) }];
    const far = [seg('12:3', 0, 4, 35.6, 45), seg('12:3', 5, 15, 45, 58)];
    expect(phrasesFromPublished(marked, published, far)!.map(words)).toEqual([['12:3', 0, 15]]);
    const near = [seg('12:3', 0, 4, 35.6, 39.3), seg('12:3', 5, 15, 39.3, 58)];
    expect(phrasesFromPublished(marked, published, near)!.map(words)).toEqual([['12:3', 0, 4], ['12:3', 5, 15]]);
  });

});

describe('phrasesFromPublished at a breath with no stop sign', () => {
  it('cuts where the aligner heard a breath with no stop sign, at the pause (since 2026-10-11)', () => {
    // From 2026-10-08 to 10-11 no caption ended without a stop sign; the user
    // heard Khalid al-Jalil breathe inside 12:86-88 with the caption carrying on.
    const near = [seg('12:3', 0, 4, 35.6, 39.3), seg('12:3', 5, 15, 39.3, 58)];
    const breath: [number, number][] = [[39.1, 39.5]];
    expect(phrasesFromPublished(passage.slice(0, 1), published, near, { quiet: breath })!.map(words)).toEqual([['12:3', 0, 4], ['12:3', 5, 15]]);
    // No gap in the recording there, no break: the aligner also cuts mid-phrase (Al-Shuraim's 17:97).
    expect(phrasesFromPublished(passage.slice(0, 1), published, near, { quiet: [] })!.map(words)).toEqual([['12:3', 0, 15]]);
    // Nor where the quiet stretch holds a word the aligner placed in it (Al-Shuraim's تَجِدَ).
    const inWord = [{ ...seg('12:3', 0, 4, 35.6, 39.3), wordTimings: [{ index: 4, start: 39.15, end: 39.45 }] }, seg('12:3', 5, 15, 39.3, 58)];
    expect(phrasesFromPublished(passage.slice(0, 1), published, inWord, { quiet: breath })!.map(words)).toEqual([['12:3', 0, 15]]);
  });

  it('never cuts before hamzat al-waṣl opening on a doubled letter (28:50, مِمَّنِ ٱتَّبَعَ)', () => {
    const text = ['وَمَنْ', 'أَضَلُّ', 'مِمَّنِ', 'ٱتَّبَعَ', 'هَوَىٰهُ'];
    const timing = { from: 0, to: 5000, segments: [[1, 0, 1000], [2, 1000, 2000], [3, 2000, 3000], [4, 3000, 4000], [5, 4000, 5000]] };
    const heard = [seg('28:50', 0, 2, 0, 3), seg('28:50', 3, 4, 3, 5)];
    expect(phrasesFromPublished([{ verseKey: '28:50', wordCount: 5, words: text }], new Map([['28:50', timing]]), heard, { quiet: [[2.8, 3.3]] })!.map(words)).toEqual([['28:50', 0, 4]]);
  });

  it('never cuts where a nūn or mīm is held into the next word (23:59, 17:97)', () => {
    const text = ['وَٱلَّذِينَ', 'هُم', 'بِرَبِّهِمْ', 'لَا', 'يُشْرِكُونَ'];
    const timing = { from: 0, to: 5000, segments: [[1, 0, 1000], [2, 1000, 2000], [3, 2000, 3000], [4, 3000, 4000], [5, 4000, 5000]] };
    const heard = [seg('23:59', 0, 1, 0, 2), seg('23:59', 2, 4, 2, 5)];
    expect(phrasesFromPublished([{ verseKey: '23:59', wordCount: 5, words: text }], new Map([['23:59', timing]]), heard)!.map(words)).toEqual([['23:59', 0, 4]]);
    const text97 = ['وَمَن', 'يُضْلِلْ', 'فَلَن', 'تَجِدَ', 'لَهُمْ'];
    const heard97 = [seg('17:97', 0, 2, 0, 3), seg('17:97', 3, 4, 3, 5)];
    expect(phrasesFromPublished([{ verseKey: '17:97', wordCount: 5, words: text97 }], new Map([['17:97', timing]]), heard97)!.map(words)).toEqual([['17:97', 0, 4]]);
  });

  it('never cuts before a word whose ٱل is absorbed into a doubled letter, however quiet the closure', () => {
    // Was a cut before 2026-10-08. Al-Muaiqly's 1:7 was split after وَلَا, on
    // the published boundary, at a held consonant the aligner took for a pause.
    const fatihah7 = new Map([['1:7', { from: 45100, to: 60300, segments: [[1, 45280, 46250], [2, 46250, 47260], [3, 47260, 48280], [4, 48280, 49360], [5, 49360, 50070], [6, 50070, 51250], [7, 51250, 52330], [8, 52330, 52760], [9, 52760, 60300]] }]]);
    const text = ['صِرَٰطَ', 'ٱلَّذِينَ', 'أَنْعَمْتَ', 'عَلَيْهِمْ', 'غَيْرِ', 'ٱلْمَغْضُوبِ', 'عَلَيْهِمْ', 'وَلَا', 'ٱلضَّآلِّينَ'];
    const heard = [seg('1:7', 0, 7, 44.92, 52.82), seg('1:7', 8, 8, 52.82, 62.59)];
    expect(phrasesFromPublished([{ verseKey: '1:7', wordCount: 9, words: text }], fatihah7, heard)!.map(words)).toEqual([['1:7', 0, 8]]);
  });
});

describe('phrasesFromPublished where the published words drift', () => {
  it("cuts where the aligner heard a pause even when the published word sits 3s off it (Al-Muaiqly's 66:9)", () => {
    // 11 words, a stop sign after word 7; the published words run early, word 8 listed at 308.8s.
    const text = ['يَـٰٓأَيُّهَا', 'ٱلنَّبِىُّ', 'جَـٰهِدِ', 'ٱلْكُفَّارَ', 'وَٱلْمُنَـٰفِقِينَ', 'وَٱغْلُظْ', 'عَلَيْهِمْ ۚ', 'وَمَأْوَىٰهُمْ', 'جَهَنَّمُ ۖ', 'وَبِئْسَ', 'ٱلْمَصِيرُ'];
    const starts = [299.9, 301.8, 303.2, 304.1, 305.0, 306.2, 308.0, 308.8, 311.8, 313.2, 315.5];
    const timing = { from: 299900, to: 320000, segments: starts.map((at, k) => [k + 1, at * 1000, (starts[k + 1] ?? 320) * 1000]) };
    const heard = [seg('66:9', 0, 6, 299.9, 311.9), seg('66:9', 7, 10, 311.9, 320)];
    const captions = phrasesFromPublished([{ verseKey: '66:9', wordCount: 11, words: text }], new Map([['66:9', timing]]), heard)!;
    expect(captions.map(c => [c.startWordIndex, c.endWordIndex, c.startTime])).toEqual([[0, 6, 299.9], [7, 10, 311.9]]);
  });
});

describe('phrasesFromPublished with incomplete or doubled timings', () => {
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

  it('reads a word listed twice as said twice where the aligner heard the reciter go back to it -- a repeat may be one word', () => {
    const twice = new Map([['2:128', { from: 0, to: 9000, segments: [[1, 0, 2000], [16, 2000, 3000], [17, 3000, 4670], [17, 5800, 8110]] }]]);
    // The aligner heard word 17 (index 16) begun again at 5.8s, after a pause.
    const heard: MatchSegment[] = [
      { ...seg('2:128', 0, 16, 0, 5.8), wordTimings: [{ index: 0, start: 0, end: 1.9 }, { index: 15, start: 2, end: 2.9 }, { index: 16, start: 3, end: 4.6 }] },
      { ...seg('2:128', 16, 16, 5.8, 9), notes: 'restarted phrase', wordTimings: [{ index: 16, start: 5.8, end: 8.1 }] },
    ];
    const captions = phrasesFromPublished([{ verseKey: '2:128', wordCount: 17 }], twice, heard, { quiet: [[4.7, 5.7]] })!;
    expect(captions.map(words)).toEqual([['2:128', 0, 16], ['2:128', 16, 16]]);
  });

  it('refuses a passage it cannot time completely', () => {
    expect(phrasesFromPublished([...passage, { verseKey: '12:7', wordCount: 7 }], published, aligned)).toBeNull();
  });
});

describe('an export with words before the first', () => {
  it('drops words listed before the ayah\u2019s first word, rather than reading them as a repeat', () => {
    // Ghamdi's 97:3 as QUL publishes it: a word 4 timed at the tail of 97:2, then the ayah.
    const leadIn = new Map([['97:3', { from: 11647, to: 16400, segments: [[4, 11520, 12310], [1, 12360, 13190], [2, 13240, 13830], [3, 13880, 14870], [4, 14920, 15350], [5, 15400, 15950], [6, 16000, 16400]] }]]);
    const captions = phrasesFromPublished([{ verseKey: '97:3', wordCount: 6 }], leadIn, [])!;
    expect(captions.map(words)).toEqual([['97:3', 0, 5]]);
    expect(captions[0].startTime).toBe(11.647);
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

  it("keeps the isti'adha and basmala the aligner heard before the passage", () => {
    // Every timed reciter's opening was dropped here; Al-Muaiqly's 1:1 had none.
    const istiadha = { kind: 'istiadha' as const, text: 'أَعُوذُ بِٱللَّهِ', start: 0.56, end: 7.16, words: [] };
    const { result } = timedFromPublished(muaiqly, { segments: aligned, audioDuration: 150, openings: [istiadha] });
    expect(result.openings).toEqual([istiadha]);
  });

  it('keeps only the passage from an aligner also given the ayahs around it', () => {
    // The aligner is given the text of the ayahs either side whose audio is in its window; the basmala it heard
    // before 12:2 is not this passage's.
    const basmala = { kind: 'basmala' as const, text: 'بِسْمِ ٱللَّهِ', start: 30, end: 33, words: [] };
    const around = [seg('12:2', 0, 6, 33, 35.4), ...aligned, seg('12:7', 0, 8, 145.1, 152)];
    const { result } = timedFromPublished(muaiqly, { segments: around, audioDuration: 160, openings: [basmala] });
    expect(new Set(result.segments.map(caption => caption.verseKey))).toEqual(new Set(['12:3', '12:6']));
    expect(result.openings).toBeUndefined();

    // Where the timings fall short and the aligner's own captions stand, the same.
    const partial = { ...muaiqly, passage: [...passage, { verseKey: '12:7', wordCount: 7 }] };
    const fallback = timedFromPublished(partial, { segments: around, openings: [basmala] }).result;
    expect(fallback.segments.map(caption => caption.verseKey)).not.toContain('12:2');
    expect(fallback.openings).toBeUndefined();
  });

  it('leaves the aligner\u2019s result alone when the timings do not cover the passage', () => {
    const partial = { ...muaiqly, passage: [...passage, { verseKey: '12:7', wordCount: 7 }] };
    const aligner = { segments: aligned, notes: 'aligned' };
    expect(timedFromPublished(partial, aligner)).toEqual({ result: aligner, pausesFromAudio: false });
  });
});

describe('an export with a word after the last', () => {
  it('drops a trailing word that never gets back to the last one, rather than reading it as a repeat', () => {
    // Sudais's 5:40 as QUL publishes its end: word 19, then word 11 over the silence before 5:41.
    const tail = new Map([['5:40', { from: 889123, to: 909568, segments: [
      [1, 889320, 889870], [2, 889920, 890630], [3, 890680, 908040], [4, 908040, 908460], [2, 908460, 909568],
    ] }]]);
    const captions = phrasesFromPublished([{ verseKey: '5:40', wordCount: 4 }], tail, [])!;
    expect(captions.map(words)).toEqual([['5:40', 0, 3]]);
  });

  it('keeps a real repeat at the end of an ayah, which says it through to the last word again', () => {
    const repeated = new Map([['5:40', { from: 0, to: 9000, segments: [
      [1, 0, 1000], [2, 1000, 2000], [3, 2000, 3000], [4, 3000, 4000], [3, 5000, 6000], [4, 6000, 9000],
    ] }]]);
    const captions = phrasesFromPublished([{ verseKey: '5:40', wordCount: 4 }], repeated, [])!;
    expect(captions.map(words)).toEqual([['5:40', 0, 3], ['5:40', 2, 3]]);
  });
});

describe('a restart the export lists scrambled', () => {
  /** An ayah as `[index, startSec]` pairs, each word running to the next. */
  const timed = (pairs: [number, number][]) => ({
    from: pairs[0][1] * 1000,
    to: (pairs[pairs.length - 1][1] + 1) * 1000,
    segments: pairs.map(([index, at], k) => [index, at * 1000, (pairs[k + 1]?.[1] ?? at + 1) * 1000]),
  });
  const runs = (captions: MatchSegment[]) => captions.map(c => [c.startWordIndex! + 1, c.endWordIndex! + 1, c.startTime]);

  it("puts back in order a going-back that names each word once (Al-Shatri's 6:59)", () => {
    const tail: [number, number][] = [[22, 89.48], [23, 90.48], [24, 91.16], [25, 91.72], [26, 92.76], [27, 93.28], [28, 94.32],
      [26, 95.64], [25, 96.28], [24, 97.28], [27, 97.92], [28, 98.88], [29, 99.52], [30, 99.96], [31, 101.32]];
    const pairs: [number, number][] = [...Array.from({ length: 21 }, (_, k): [number, number] => [k + 1, 70 + k]), ...tail];
    const captions = phrasesFromPublished([{ verseKey: '6:59', wordCount: 31 }], new Map([['6:59', timed(pairs)]]), [])!;
    // One restart, from 24 at 95.64s -- not three one-word captions out of order.
    expect(runs(captions)).toEqual([[1, 28, 70], [24, 31, 95.64]]);
  });

  it("finds where Abdul Basit went back to in 2:164 (40 39 37 38 40)", () => {
    const pairs: [number, number][] = [...Array.from({ length: 40 }, (_, k): [number, number] => [k + 1, k]),
      [39, 40], [37, 41], [38, 42], [40, 43], [41, 44], [42, 45], [43, 46]];
    const captions = phrasesFromPublished([{ verseKey: '2:164', wordCount: 43 }], new Map([['2:164', timed(pairs)]]), [])!;
    expect(runs(captions)).toEqual([[1, 40, 0], [37, 43, 40]]);
  });

  it("drops a 'repeat' whose words start closer together than anyone recites (Khalid al-Jalil's 25:16)", () => {
    // Words 2-4 listed again within 161ms at the end of يَشَآءُونَ, then his real restart from word 1.
    const segments = [[1, 247725, 248322], [2, 248164, 249118], [3, 249277, 249437], [4, 249277, 251985],
      [2, 252064, 252304], [3, 252225, 252383], [4, 252225, 253020], [1, 253245, 253418], [2, 253805, 254135],
      [3, 254434, 254454], [4, 254925, 256604], [5, 257085, 257878]];
    const captions = phrasesFromPublished([{ verseKey: '25:16', wordCount: 5 }], new Map([['25:16', { from: 247725, to: 258000, segments }]]), [])!;
    expect(runs(captions)).toEqual([[1, 4, 247.725], [1, 5, 253.245]]);
  });

  it('keeps a quick real repeat, two words started 200ms apart (Al-Shatri\u2019s 9:38)', () => {
    const pairs: [number, number][] = [[1, 0], [2, 1], [3, 1.5], [2, 2.5], [3, 2.7], [4, 3.5]];
    const captions = phrasesFromPublished([{ verseKey: '9:38', wordCount: 4 }], new Map([['9:38', timed(pairs)]]), [])!;
    expect(runs(captions)).toEqual([[1, 3, 0], [2, 4, 2.5]]);
  });

  it('drops a stray went-back word that is no restart, giving its time to the word before', () => {
    const pairs: [number, number][] = [[1, 0], [2, 1], [3, 2], [4, 3], [2, 4], [5, 5], [6, 6]];
    const captions = phrasesFromPublished([{ verseKey: '9:1', wordCount: 6 }], new Map([['9:1', timed(pairs)]]), [])!;
    expect(runs(captions)).toEqual([[1, 6, 0]]);
    expect(captions[0].wordTimings?.find(word => word.index === 3)).toEqual({ index: 3, start: 3, end: 5 });
  });
});

describe("an ayah's last word stretched past its end", () => {
  it("ends the caption where the ayah ends, not over the next one (Ghamdi's 10:22)", () => {
    const stretched = new Map([['10:22', { from: 461458, to: 515991, segments: [[1, 462080, 511640], [2, 511640, 533633]] }]]);
    const [caption] = phrasesFromPublished([{ verseKey: '10:22', wordCount: 2 }], stretched, [])!;
    expect(caption.endTime).toBe(515.991);
  });
});

describe('published bounds that disagree with their neighbours', () => {
  it("starts an ayah at its own start when its first word is stretched back into the one before (Al-Rifai's 4:12)", () => {
    const early = new Map([['4:12', { from: 324097, to: 410554, segments: [[1, 308900, 328820], [2, 328820, 410554]] }]]);
    expect(phrasesFromPublished([{ verseKey: '4:12', wordCount: 2 }], early, [])![0].startTime).toBe(324.097);
  });

  it("never lets one ayah overlap the next, even where one is listed from 0s (Ghamdi's 55:1-2)", () => {
    const listed = new Map([
      ['55:1', { from: 0, to: 4071, segments: [[1, 0, 4070]] }],
      ['55:2', { from: 0, to: 8213, segments: [[1, 3160, 5310], [2, 5360, 8210]] }],
    ]);
    const captions = phrasesFromPublished([{ verseKey: '55:1', wordCount: 1 }, { verseKey: '55:2', wordCount: 2 }], listed, [])!;
    expect(captions.map(c => [c.verseKey, c.startTime, c.endTime])).toEqual([['55:1', 0, 3.16], ['55:2', 3.16, 8.213]]);
  });
});

describe('an export listing the first word last', () => {
  it("keeps the ayah's words when word 1 comes after the last (Abdul Basit's 39:32)", () => {
    const listed = new Map([['39:32', { from: 788992, to: 799978, segments: [[3, 780880, 781670], [2, 781720, 782790], [3, 782840, 784710], [4, 784760, 797830], [1, 797880, 799978]] }]]);
    const captions = phrasesFromPublished([{ verseKey: '39:32', wordCount: 4 }], listed, [seg('39:32', 0, 3, 780.08, 800.2)])!;
    expect(captions.map(c => [c.startWordIndex, c.endWordIndex, c.startTime])).toEqual([[0, 3, 780.88]]);
  });

  it('drops a stray first word that is not word 1 even with no aligner to ask', () => {
    const listed = new Map([['39:32', { from: 788992, to: 799978, segments: [[3, 780880, 781670], [2, 781720, 782790], [3, 782840, 784710], [4, 784760, 799978]] }]]);
    const captions = phrasesFromPublished([{ verseKey: '39:32', wordCount: 4 }], listed, [])!;
    expect(captions.map(c => [c.startWordIndex, c.endWordIndex, c.startTime])).toEqual([[0, 3, 780.88]]);
  });
});

describe('a going-back the aligner did not hear', () => {
  it("is no restart: Abdul Basit's 39:32 lists 3 2 3 4, and the aligner heard the ayah once through", () => {
    const listed = new Map([['39:32', { from: 788992, to: 799978, segments: [[3, 780900, 781700], [2, 781700, 782800], [3, 782800, 784800], [4, 784800, 799978]] }]]);
    const heard = [seg('39:31', 0, 6, 769.1, 780.08), seg('39:32', 0, 3, 780.08, 800.2)];
    const captions = phrasesFromPublished([{ verseKey: '39:32', wordCount: 4 }], listed, heard)!;
    expect(captions.map(words)).toEqual([['39:32', 0, 3]]);
    // Its start is the words', not the ayah bound listed eight seconds late.
    expect(captions[0].startTime).toBe(780.9);
  });
});

describe('the aligner seeming to go back into an earlier ayah', () => {
  it("does not overrule the published timings: Al-Tunaiji's 23:87 ends as 23:85 does, and the aligner took one for the other", () => {
    // 23:85 ends قُلْ أَفَلَا تَذَكَّرُونَ and 23:87 قُلْ أَفَلَا تَتَّقُونَ. Trusting the aligner's
    // "going back" there showed 23:85 over the end of 23:87.
    const timings = new Map([['23:86', { from: 1043441, to: 1051433 }], ['23:87', { from: 1051633, to: 1060677 }]]);
    const heard = { segments: [seg('23:86', 0, 7, 1043.7, 1051.88), seg('23:87', 0, 1, 1051.88, 1056.02), seg('23:85', 2, 4, 1056.02, 1060.86)] };
    const passage = [{ verseKey: '23:86', wordCount: 8 }, { verseKey: '23:87', wordCount: 5 }];
    const { result } = timedFromPublished({ provider: 'qul', passage, timings }, heard);
    expect(result.segments.map(c => [c.verseKey, c.startTime])).toEqual([['23:86', 1043.441], ['23:87', 1051.633]]);
  });
});

describe('an aligner result its own warning doubted', () => {
  // Khalid al-Jalil's 74:8-9 as QUL times them.
  const qul = new Map([
    ['74:8', { from: 18318, to: 26776, segments: [[1, 18420, 19300], [2, 19300, 19860], [3, 19860, 20830], [4, 20830, 26776]] }],
    ['74:9', { from: 26806, to: 31661, segments: [[1, 26910, 28450], [2, 28450, 29990], [3, 29990, 30750], [4, 30750, 31661]] }],
  ]);
  const passage = [{ verseKey: '74:8', wordCount: 4 }, { verseKey: '74:9', wordCount: 4 }];
  const word = (index: number, start: number) => ({ index, start, end: start + 0.5 });
  const heard = [
    { ...seg('74:8', 0, 3, 18.33, 21.87), wordTimings: [word(0, 18.4), word(1, 19.3), word(2, 19.9), word(3, 20.8)] },
    { ...seg('74:9', 0, 3, 21.87, 27.35), wordTimings: [word(0, 21.95), word(1, 23.4), word(2, 24.9), word(3, 25.7)] },
    { ...seg('74:9', 0, 3, 27.35, 31.79), wordTimings: [word(0, 27.0), word(1, 28.5), word(2, 30.0), word(3, 30.8)] },
  ];
  const doubted = { segments: heard, warning: 'What this recording says and the supplied text only agree 31% of the way.' };

  it('is listened to when its words agree with the published times', () => {
    // The warning measures the aligner's whole padded window, and on a passage this short the padding outweighs the
    // passage: 74:8-11 came in at 31%, and the warning used to leave a quarter of all reciter passages without pauses.
    expect(timedFromPublished({ provider: 'qul', passage, timings: qul }, doubted).pausesFromAudio).toBe(true);
  });

  it('is not when they do not', () => {
    const elsewhere = heard.map(s => ({ ...s, wordTimings: s.wordTimings.map(w => ({ ...w, start: w.start + 20, end: w.end + 20 })) }));
    expect(timedFromPublished({ provider: 'qul', passage, timings: qul }, { ...doubted, segments: elsewhere }).pausesFromAudio).toBe(false);
  });
});

describe('inTheGaps', () => {
  // Khalid al-Jalil's 12:87, as measured (2026-10-11): the voice stops at 1554.08s and 1559.24s.
  const quiet: [number, number][] = [[1548.52, 1548.92], [1554.14, 1554.48], [1555.22, 1555.32], [1559.28, 1559.74]];
  /** A caption whose first word is heard from `first`. */
  const opens = (caption: MatchSegment, first: number): MatchSegment => ({ ...caption, wordTimings: [{ index: caption.startWordIndex!, start: first, end: first + 0.5 }] });
  const captions = [opens(seg('12:87', 0, 5, 1542.1, 1548.7), 1542.3), opens(seg('12:87', 6, 10, 1548.7, 1554.6), 1549.1),
    opens(seg('12:87', 6, 10, 1554.6, 1558.7), 1554.6), opens(seg('12:87', 11, 19, 1558.7, 1571.2), 1559.8)];

  it('changes caption in the gap where the voice stops, just before it starts again, not at a word edge half a second off', () => {
    const times = inTheGaps(captions, quiet).map(c => [c.startTime, c.endTime]);
    expect(times).toEqual([[1542.1, 1548.82], [1548.82, 1554.38], [1554.38, 1559.64], [1559.64, 1571.2]]);
  });


  it('takes the nearest gap, not a closure inside the next word that is as long (12:88)', () => {
    const at88 = [seg('12:88', 9, 16, 1579.4, 1587.11), { ...seg('12:88', 17, 20, 1587.11, 1591.1), wordTimings: [{ index: 17, start: 1587.34, end: 1588.26 }] }];
    const gaps: [number, number][] = [[1586.28, 1586.66], [1586.9, 1587.3], [1587.78, 1588.18]];
    expect(inTheGaps(at88, gaps).map(c => c.startTime)).toEqual([1579.4, 1587.2]);
  });

  it('ignores a dip too short to be the voice stopping, and leaves a change with no gap near alone', () => {
    const closures: [number, number][] = [[1555.22, 1555.32], [1561.0, 1561.4]];
    expect(inTheGaps(captions, closures)).toEqual(captions);
    expect(inTheGaps(captions, undefined)).toBe(captions);
  });

  it("never into a hum that runs on into the next caption's first word (17:96, إِنَّهُۥ)", () => {
    const at96 = [seg('17:96', 0, 7, 1075.8, 1080.3), { ...seg('17:96', 8, 12, 1080.3, 1086.4), wordTimings: [{ index: 8, start: 1080.55, end: 1081.4 }] }];
    expect(inTheGaps(at96, [[1080.6, 1081.2]])).toEqual(at96);
  });

  it("never into a closure inside the caption's own last word (17:97, ٱلْمُهْتَدِ)", () => {
    const at97 = [{ ...seg('17:97', 0, 4, 1086, 1090.4), wordTimings: [{ index: 4, start: 1089.1, end: 1090.34 }] }, seg('17:97', 5, 9, 1090.4, 1093)];
    expect(inTheGaps(at97, [[1089.4, 1089.8]])).toEqual(at97);
  });

  it("reads where the aligner heard the next word start too, when the caption's own time is late (36:56)", () => {
    const at56 = [seg('36:56', 0, 6, 515, 520.9), { ...seg('36:56', 7, 7, 520.9, 523), wordTimings: [{ index: 7, start: 521.6, end: 522.6 }] }];
    const heard = [{ ...seg('36:56', 7, 7, 520.9, 523), wordTimings: [{ index: 7, start: 520.95, end: 522.5 }] }];
    expect(inTheGaps(at56, [[521.0, 521.4]], heard)).toEqual(at56);
  });

  it('never moves a change so far that a caption is left almost empty', () => {
    // The gap's middle (11.35s) would leave the second caption 0.25s.
    const short = [seg('1:1', 0, 1, 10, 11), seg('1:1', 2, 3, 11, 11.6)];
    expect(inTheGaps(short, [[11.2, 11.5]])).toEqual(short);
  });
});

describe('inTheGaps, a long pause', () => {
  it('takes a pause of a second or more for one, whatever word the aligner put at its start (Al-Muaiqly 32:18, 2026-10-17)', () => {
    // «فَاسِقًا ۚ» ends at 28.2 s, the pause runs to 30.16 s, «لَّا يَسْتَوُۥنَ» starts at 30.5 s; the aligner put «لَّا» at 28.21 s.
    const at18 = [{ ...seg('32:18', 0, 5, 20.1, 28.21), wordTimings: [{ index: 5, start: 27.01, end: 28.07 }] },
      { ...seg('32:18', 6, 7, 28.21, 34.9), wordTimings: [{ index: 6, start: 28.21, end: 28.23 }] }];
    expect(inTheGaps(at18, [[28.26, 30.16]]).map(c => c.startTime)).toEqual([20.1, 30.06]);
  });
});

/** Published word times, each running to the next's start, as QUL lists them. */
const listedFrom = (starts: number[], to: number) =>
  starts.map((start, k) => [k + 1, Math.round(start * 1000), Math.round((starts[k + 1] ?? to) * 1000)]);
/** One aligner phrase over the ayah, with the words it heard, 0-based. */
const heardAs = (verseKey: string, heard: [number, number, number][]): MatchSegment[] => [{
  ...seg(verseKey, 0, Math.max(...heard.map(([index]) => index)), heard[0][1], heard[heard.length - 1][2]),
  wordTimings: heard.map(([index, start, end]) => ({ index, start, end })),
}];

describe('a repeat the export lists once', () => {

  // Khalid al-Jalil's 12:46: يَأْكُلُهُنَّ سَبْعٌ عِجَافٌ said, a pause, and said
  // again; QUL times only the second, سِمَانٍ stretched over the first.
  const v46 = new Map([['12:46', {
    from: 804700, to: 830400,
    segments: listedFrom([804.651, 805.502, 806.283, 807.344, 808.255, 808.595, 809.145, 810.517, 815.452, 816.943,
      817.684, 818.895, 819.656, 821.037, 822.058, 822.809, 824.591, 825.482, 826.363, 827.134, 827.804, 828.845], 830.4),
  }]]);
  const heard46 = heardAs('12:46', [[0, 804.806, 805.523], [1, 805.669, 806.24], [2, 806.589, 807.275], [3, 807.509, 808.072],
    [4, 808.429, 808.55], [5, 808.789, 809.187], [6, 809.309, 810.222], [7, 810.736, 811.337], [8, 812.09, 813.01],
    [9, 813.429, 813.886], [10, 814.149, 815.24], [8, 815.594, 816.594], [9, 817.109, 817.55], [10, 817.829, 818.506],
    [11, 819.019, 819.621], [12, 819.829, 820.895], [13, 821.269, 821.771], [14, 822.205, 822.727], [15, 823.029, 824.081]]);
  const quiet46: [number, number][] = [[811.9, 812.1], [812.84, 813.04], [814.82, 815.48], [815.62, 815.86], [817.18, 817.38]];
  const ayah46 = [{ verseKey: '12:46', wordCount: 22 }];

  it("starts a caption at the pass the export left out, from the aligner's times (Khalid al-Jalil's 12:46)", () => {
    const captions = phrasesFromPublished(ayah46, v46, heard46, { quiet: quiet46 })!;
    expect(captions.map(words)).toEqual([['12:46', 0, 10], ['12:46', 8, 21]]);
    // In the pause between the two passes, before يَأْكُلُهُنَّ is heard again at 815.59s.
    const change = inTheGaps(captions, quiet46, heard46)[1].startTime!;
    expect(change).toBeGreaterThanOrEqual(814.82);
    expect(change).toBeLessThan(815.59);
  });

  it('adds no pass where the reciter did not stop before going back, or with nothing to say he did', () => {
    expect(phrasesFromPublished(ayah46, v46, heard46, { quiet: [] })!.map(words)).toEqual([['12:46', 0, 21]]);
    expect(phrasesFromPublished(ayah46, v46, heard46)!.map(words)).toEqual([['12:46', 0, 21]]);
  });

  it('adds none where the export already lists both passes', () => {
    const both = new Map([['12:46', { ...v46.get('12:46')!, segments: [...v46.get('12:46')!.segments, [9, 812090, 813010], [10, 813429, 813886], [11, 814149, 815240]].sort((a, b) => a[1] - b[1]) }]]);
    const captions = phrasesFromPublished(ayah46, both, heard46, { quiet: quiet46 })!;
    expect(captions.map(words)).toEqual([['12:46', 0, 10], ['12:46', 8, 21]]);
  });

});

describe('a second pass the export leaves out', () => {
  it("ends the word before it where it was heard to end, so the change can sit in the pause (12:47)", () => {
    // فَذَرُوهُ فِى سُنۢبُلِهِۦٓ twice; QUL times the first, سُنۢبُلِهِۦٓ stretched over the second.
    const v47 = new Map([['12:47', {
      from: 830500, to: 846900,
      segments: listedFrom([830.557, 831.128, 832.259, 832.859, 833.6, 834.521, 835.112, 836.103, 837.064, 837.464,
        842.079, 842.799, 843.94, 844.801], 846.9),
    }]]);
    const heard47 = heardAs('12:47', [[0, 830.689, 830.768], [1, 831.309, 832.123], [2, 832.429, 832.841], [3, 833.029, 833.479],
      [4, 833.749, 834.356], [5, 834.71, 834.914], [6, 835.309, 836.03], [7, 836.269, 837.146], [8, 837.229, 837.464],
      [9, 837.629, 838.82], [7, 839.309, 840.015], [8, 840.269, 840.414], [9, 840.629, 841.61], [10, 842.269, 842.566],
      [11, 842.989, 843.602], [12, 844.037, 844.559], [13, 844.989, 845.755]]);
    const quiet47: [number, number][] = [[837.08, 837.34], [838.7, 839.22], [842.08, 842.34], [843.68, 843.98]];
    const captions = phrasesFromPublished([{ verseKey: '12:47', wordCount: 14 }], v47, heard47, { quiet: quiet47 })!;
    expect(captions.map(words)).toEqual([['12:47', 0, 9], ['12:47', 7, 13]]);
    // The pause is 838.7-839.22 s: the change comes 0.1 s before he resumes.
    expect(inTheGaps(captions, quiet47, heard47)[1].startTime).toBe(839.12);
  });
});

describe('a repeat the export lists once, where its words are off altogether', () => {
  it("adds no pass when the pass it lists is not where the aligner heard it (Khalid al-Jalil's 12:57)", () => {
    // He recites the ayah through, then وَلَأَجْرُ ٱلْءَاخِرَةِ twice; QUL stretches word 2 over 1005-1013s.
    const v57 = new Map([['12:57', { from: 1000148, to: 1020478, segments: [[1, 1000248, 1005243], [2, 1005243, 1013481],
      [3, 1013481, 1014142], [4, 1014242, 1015423], [5, 1015423, 1016354], [6, 1016354, 1017535], [7, 1017535, 1020428]] }]]);
    const heard: MatchSegment[] = [{
      ...seg('12:57', 0, 6, 1000.449, 1016),
      wordTimings: [[0, 1000.449, 1001.325], [1, 1001.489, 1002.362], [2, 1002.609, 1003.08], [3, 1003.355, 1004.037],
        [4, 1004.409, 1005.074], [5, 1005.449, 1006.031], [6, 1006.369, 1007.227], [0, 1008.569, 1009.62], [1, 1009.849, 1010.816],
        [0, 1011.409, 1012.331], [1, 1012.489, 1013.368], [2, 1013.649, 1014.086], [3, 1014.361, 1014.724]]
        .map(([index, start, end]) => ({ index, start, end })),
    }];
    const quiet: [number, number][] = [[1007.94, 1008.46], [1010.82, 1011.28]];
    expect(phrasesFromPublished([{ verseKey: '12:57', wordCount: 7 }], v57, heard, { quiet })!.map(words)).toEqual([['12:57', 0, 6]]);
  });
});

describe('a pass the aligner heard that is not plain', () => {
  it("adds none the aligner squeezed in, 20ms a word (Khalid al-Jalil's 2:36, فِى ٱلْأَرْضِ)", () => {
    const listed = new Map([['2:36', { from: 550311, to: 567238, segments: [[12, 560832, 561452], [13, 561452, 562613],
      [14, 562613, 562844], [15, 562844, 563534], [16, 563534, 564876], [17, 564876, 566207], [18, 566207, 566557], [19, 566557, 567188]] }]]);
    const heard = heardAs('2:36', [[11, 561.04, 561.675], [12, 561.87, 561.914], [13, 562.133, 562.153], [14, 562.532, 562.552],
      [13, 562.851, 562.871], [14, 563.04, 563.589], [15, 563.72, 564.786], [16, 565.14, 565.902], [17, 566.24, 566.461], [18, 566.76, 567.099]]);
    const quiet: [number, number][] = [[561.511, 561.851], [562.231, 562.731], [562.851, 563.411]];
    expect(phrasesFromPublished([{ verseKey: '2:36', wordCount: 19 }], listed, heard, { quiet })!.map(words)).toEqual([['2:36', 0, 18]]);
  });

  it("adds none where the aligner also goes back inside the earlier pass (Khalid al-Jalil's 2:243)", () => {
    // ...لَذُو فَضْلٍ عَلَى ٱلنَّاسِ وَلَـٰكِنَّ أَكْثَرَ ٱلنَّاسِ لَا يَشْكُرُونَ, read by the aligner as words 18-26, 25, then 18 again.
    const listed = new Map([['2:243', { from: 4923249, to: 4957613, segments: [[16, 4934500, 4934861], [17, 4934861, 4945231],
      [18, 4945231, 4946012], [19, 4946092, 4946723], [20, 4946723, 4947283], [21, 4947283, 4947994], [22, 4947994, 4948534],
      [23, 4948695, 4951597], [24, 4951597, 4953489], [25, 4953489, 4954360], [26, 4955081, 4955812], [27, 4955812, 4956182],
      [28, 4956182, 4957563]] }]]);
    const heard = heardAs('2:243', [[15, 4934.329, 4934.739], [16, 4935.049, 4935.779], [17, 4936.409, 4936.499], [18, 4937.329, 4937.609],
      [19, 4937.889, 4938.169], [20, 4938.489, 4938.969], [21, 4939.183, 4939.203], [22, 4939.849, 4940.159], [23, 4940.409, 4941.119],
      [24, 4941.649, 4942.149], [25, 4942.809, 4943.109], [24, 4943.769, 4944.459], [17, 4945.418, 4945.578], [18, 4946.329, 4946.689],
      [19, 4946.849, 4947.249], [20, 4947.489, 4948.049], [21, 4948.209, 4948.289]]);
    const quiet: [number, number][] = [[4935.948, 4936.348], [4941.688, 4941.908], [4944.948, 4945.328]];
    expect(phrasesFromPublished([{ verseKey: '2:243', wordCount: 28 }], listed, heard, { quiet })!.map(words)).toEqual([['2:243', 0, 27]]);
  });
});

describe('a pass the aligner heard outside the ayah', () => {
  it("adds none past the ayah's published end (Khalid al-Jalil's 9:81, its last words placed over 9:82)", () => {
    const listed = new Map([['9:81', { from: 1617025, to: 1645243, segments: [[23, 1640839, 1641619], [24, 1641619, 1642230],
      [25, 1642330, 1642760], [26, 1642760, 1643491], [27, 1643551, 1645193]] }]]);
    const heard = heardAs('9:81', [[22, 1640.176, 1641.612], [23, 1641.816, 1642.331], [24, 1642.605, 1642.889], [25, 1642.936, 1643.448],
      [26, 1643.776, 1644.565], [24, 1645.319, 1645.922], [25, 1651.816, 1652.147], [26, 1652.456, 1653.184]]);
    const quiet: [number, number][] = [[1644.787, 1645.147], [1645.667, 1645.887]];
    expect(phrasesFromPublished([{ verseKey: '9:81', wordCount: 27 }], listed, heard, { quiet })!.map(words)).toEqual([['9:81', 0, 26]]);
  });
});

describe('a pass that is a sliver of the aligner or a silence', () => {
  it("adds none opening on a word the aligner gave 20ms (Al-Shatri's 2:99, وَمَا يَكْفُرُ said once)", () => {
    const listed = new Map([['2:99', { from: 2005666, to: 2017305, segments: [[1, 2005960, 2006870], [2, 2006920, 2008630],
      [3, 2008680, 2009430], [4, 2009480, 2010910], [5, 2010960, 2012750], [6, 2012800, 2013270], [7, 2013320, 2013950],
      [8, 2014000, 2015150], [9, 2015200, 2015750], [10, 2015800, 2017305]] }]]);
    const heard = heardAs('2:99', [[0, 2005.96, 2006.405], [1, 2006.72, 2007.841], [2, 2008.64, 2009.118], [3, 2009.4, 2010.235],
      [4, 2010.829, 2011.99], [5, 2011.88, 2012.229], [6, 2012.229, 2012.788], [5, 2012.927, 2012.947], [6, 2013.32, 2013.984],
      [7, 2014.04, 2014.303], [8, 2015.12, 2015.42], [9, 2015.68, 2016.697]]);
    const quiet: [number, number][] = [[2005.411, 2005.911], [2012.111, 2012.671], [2013.351, 2013.631]];
    expect(phrasesFromPublished([{ verseKey: '2:99', wordCount: 10 }], listed, heard, { quiet })!.map(words)).toEqual([['2:99', 0, 9]]);
  });

  it("adds none lying in the silence before the ayah (Al-Tunaiji's 12:106)", () => {
    const listed = new Map([['12:106', { from: 2293711, to: 2303688, segments: [[1, 2294400, 2294870], [2, 2294920, 2295710],
      [3, 2295760, 2297790], [4, 2297840, 2298790], [5, 2298840, 2299470], [6, 2299520, 2300990], [7, 2301040, 2303688]] }]]);
    const heard = heardAs('12:106', [[0, 2293.668, 2293.828], [1, 2293.8, 2294.226], [0, 2294.32, 2294.625], [1, 2294.92, 2295.582],
      [2, 2295.68, 2296.778], [3, 2297.851, 2298.533], [4, 2298.84, 2299.251], [5, 2299.64, 2300.048], [6, 2300.961, 2304.196]]);
    const quiet: [number, number][] = [[2293.251, 2294.171], [2295.731, 2295.971], [2301.011, 2301.631]];
    expect(phrasesFromPublished([{ verseKey: '12:106', wordCount: 7 }], listed, heard, { quiet })!.map(words)).toEqual([['12:106', 0, 6]]);
  });
});

/** One aligner phrase: its words [first, last], its span [start, end] in seconds, and the words it heard there. */
const timed = (verseKey: string, [from, to]: number[], [startTime, endTime]: number[], words: number[][], notes?: string): MatchSegment =>
  ({ ...seg(verseKey, from, to, startTime, endTime), notes, wordTimings: words.map(([index, start, end]) => ({ index, start, end })) });

describe("the user's ground truth for the Quran Foundation's ayah files (2026-10-15): repeats", () => {

  it("starts a caption at a one-word repeat after a long stop (Al-Shatri's 10:12, فَلَمَّا ... فَلَمَّا)", () => {
    const published = new Map([['10:12', { from: 85995, to: 116349, segments: [[1, 86325, 87035], [2, 87045, 87585], [3, 87595, 89175],
      [4, 89185, 89925], [5, 89935, 90885], [6, 90895, 93025], [7, 93035, 93405], [8, 93415, 94375], [9, 94385, 94755],
      [10, 94765, 96805], [11, 96815, 100435], [12, 100445, 101345], [13, 101355, 102005], [14, 102015, 103135],
      [15, 103145, 103655], [16, 103665, 104095], [17, 104105, 104635], [18, 104645, 105985], [19, 105995, 106835],
      [20, 106845, 108305], [21, 108315, 109735], [22, 109745, 110675], [23, 110685, 111535], [24, 111545, 113035],
      [25, 113045, 113385], [26, 113395, 114195], [27, 114205, 115985]] }]]);
    const aligned = [
      timed('10:12', [0, 10], [86.05, 98.78], [[0, 86.45, 86.84], [1, 87.21, 87.56], [2, 87.81, 88.92], [3, 89.57, 89.95], [4, 90.13, 90.67],
        [5, 91.01, 92.19], [6, 93.21, 93.38], [7, 93.61, 94.26], [8, 94.57, 94.82], [9, 94.93, 96.33], [10, 97.17, 97.85]]),
      // The aligner's own restart: فَلَمَّا again, after a second's silence.
      timed('10:12', [10, 20], [98.78, 109.43], [[10, 99.32, 100.08], [11, 100.61, 101.2], [12, 101.61, 101.83], [13, 102.21, 102.79],
        [14, 103.21, 103.59], [15, 103.85, 104.15], [16, 104.34, 104.55], [17, 104.85, 105.5], [18, 106.45, 106.7],
        [19, 107.09, 107.58], [20, 108.33, 108.93]], 'restarted phrase'),
      timed('10:12', [21, 26], [109.43, 116.35], [[21, 109.89, 110.53]]),
    ];
    const quiet: [number, number][] = [[98.38, 99.4], [100.68, 100.98], [107.14, 107.4], [108.46, 108.76], [108.98, 109.8]];
    const captions = phrasesFromPublished([{ verseKey: '10:12', wordCount: 27 }], published, aligned, { quiet })!;
    expect(captions.map(words)).toEqual([['10:12', 0, 10], ['10:12', 10, 20], ['10:12', 21, 26]]);
  });

});

describe("the user's ground truth for the Quran Foundation's ayah files (2026-10-15): stops", () => {
  it("does not cut at a stop sign the reciter ran on through (Al-Tablawi's 32:14, نَسِينَـٰكُمْ ۖ)", () => {
    const published = new Map([['32:14', { from: 18521, to: 37042, segments: [[1, 18591, 19531], [2, 19541, 20101],
      [3, 20111, 20921], [4, 20931, 23301], [5, 23311, 24241], [6, 24251, 24751], [7, 24761, 27851], [8, 27861, 29131],
      [9, 29141, 30131], [10, 30141, 30871], [11, 30881, 31701], [12, 31711, 32221], [13, 32231, 33781], [14, 33791, 36401]] }]]);
    const text = ['فَذُوقُوا۟', 'بِمَا', 'نَسِيتُمْ', 'لِقَآءَ', 'يَوْمِكُمْ', 'هَـٰذَآ', 'إِنَّا', 'نَسِينَـٰكُمْ ۖ', 'وَذُوقُوا۟', 'عَذَابَ', 'ٱلْخُلْدِ', 'بِمَا', 'كُنتُمْ', 'تَعْمَلُونَ'];
    const aligned = [
      timed('32:14', [0, 7], [18.41, 29.03], [[0, 18.77, 19.46], [1, 19.73, 19.86], [2, 20.25, 20.97], [3, 21.21, 23.2], [4, 23.45, 24.0],
        [5, 24.49, 24.88], [6, 26.85, 27.51], [7, 28.01, 28.87]]),
      timed('32:14', [8, 13], [29.03, 36.82], [[8, 29.37, 30.06], [9, 30.29, 30.86], [10, 31.05, 31.82], [11, 31.81, 32.14],
        [12, 32.45, 33.73], [13, 34.01, 35.01]]),
    ];
    const quiet: [number, number][] = [[18.88, 19.28], [20.32, 20.94], [23.74, 24.14], [28.04, 28.5], [28.78, 29.12], [29.42, 29.86],
      [31.04, 31.38], [31.5, 31.74], [32.26, 32.68], [33.48, 33.94], [36.38, 37.28]];
    const ayah = [{ verseKey: '32:14', wordCount: 14, words: text }];
    expect(phrasesFromPublished(ayah, published, aligned, { quiet })!.map(words)).toEqual([['32:14', 0, 13]]);
    // A real stop there -- a second of quiet between the words -- still splits it.
    const stopped: [number, number][] = [...quiet, [28.9, 29.35]];
    expect(phrasesFromPublished(ayah, published, aligned, { quiet: stopped })!.map(words)).toEqual([['32:14', 0, 7], ['32:14', 8, 13]]);
    // And so does one the level meter missed -- an echoing recording, as Al-Minshawi's Mujawwad is --
    // when the aligner heard the words 1.1s apart.
    const apart = [aligned[0], { ...aligned[1], wordTimings: [{ index: 8, start: 29.97, end: 30.66 }, ...aligned[1].wordTimings!.slice(1)] }];
    const noQuietThere: [number, number][] = quiet.filter(([from]) => from < 28 || from > 30);
    expect(phrasesFromPublished(ayah, published, apart, { quiet: noQuietThere })!.map(words)).toEqual([['32:14', 0, 7], ['32:14', 8, 13]]);
  });
});

describe("the passage's edges at the voice (2026-10-15)", () => {
  // Al-Minshawi's Mujawwad 32:16-18: the first word at 1.7s, the last sung out to 88.26s, the file 90.78s.
  const captions = (): MatchSegment[] => [
    { verseKey: '32:16', startTime: 0, endTime: 31.4, wordTimings: [{ index: 0, start: 1.7, end: 4.08 }] },
    { verseKey: '32:18', startTime: 63.43, endTime: 90.78, wordTimings: [{ index: 6, start: 83.27, end: 84.01 }, { index: 7, start: 84.02, end: 85.27 }] },
  ];

  it('starts a breath before the first word and ends a second into the quiet that runs to the end', () => {
    const edged = toTheVoice(captions(), [[0, 2.08], [77.3, 83.38], [88.26, 90.76]]);
    expect(edged.map(caption => [caption.startTime, caption.endTime])).toEqual([[1.3, 31.4], [63.43, 89.26]]);
  });

  it('keeps the end where no quiet was measured after the last word, a held madd sung on past its listed end', () => {
    expect(toTheVoice(captions(), [[0, 2.08], [77.3, 83.38]]).at(-1)!.endTime).toBe(90.78);
    expect(toTheVoice(captions(), undefined).at(-1)!.endTime).toBe(90.78);
  });
});

describe('words heard later than the Quran Foundation lists them (2026-10-15)', () => {
  // Al-Minshawi's Mujawwad 32:17, in its passage 32:16-18: مَّآ listed for 10ms, لَهُم over 7.2s.
  const published = new Map([['32:17', { from: 31400, to: 63430, segments: [[1, 32600, 33600], [2, 33610, 35010], [3, 35020, 35560],
    [4, 35570, 35580], [5, 35590, 36700], [6, 36710, 43910], [7, 43920, 46040], [8, 46050, 47900], [9, 47910, 50650],
    [10, 50660, 54930], [11, 54940, 56150], [12, 56160, 58010], [13, 58020, 61100]] }]]);
  const heard: [number, number, number][] = [[0, 32.65, 33.34], [1, 33.89, 34.94], [2, 35.69, 36.85], [3, 38.32, 38.45], [4, 41.25, 42.91],
    [5, 43.05, 43.71], [6, 44.95, 45.31], [7, 46.46, 47.54], [8, 48.13, 49.46], [9, 50.77, 54.08], [10, 55.16, 55.6], [11, 56.45, 57.43],
    [12, 58.25, 60.7]];
  const ayah = [{ verseKey: '32:17', wordCount: 13 }];
  const starts = (aligned: MatchSegment[]) =>
    phrasesFromPublished(ayah, published, aligned)!.flatMap(caption => caption.wordTimings!.map(word => word.start));

  it('starts a word where it was heard, when that is plainly later than listed', () => {
    expect(starts([timed('32:17', [0, 12], [32.56, 63.35], heard)])).toEqual(
      [32.6, 33.61, 35.69, 38.32, 41.25, 43.05, 44.95, 46.05, 47.91, 50.66, 54.94, 56.16, 58.02]);
  });

  it('leaves the listed times where the ayah was not heard plainly: a word missing, or none heard', () => {
    const listed = [32.6, 33.61, 35.02, 35.57, 35.59, 36.71, 43.92, 46.05, 47.91, 50.66, 54.94, 56.16, 58.02];
    expect(starts([timed('32:17', [0, 12], [32.56, 63.35], heard.filter(([index]) => index !== 7))])).toEqual(listed);
    expect(starts([])).toEqual(listed);
  });

  it('keeps the listed start of letters said by name, which the aligner hears only at their last (2026-10-17)', () => {
    // Al-Muaiqly's 2:1 «الٓمٓ», listed from 0.68s; the aligner hears it at «مٓ», 6.1s on, and the passage opened there.
    const letters = new Map([['2:1', { from: 0, to: 10057, segments: [[1, 677, 9327]] }]]);
    const said = phrasesFromPublished([{ verseKey: '2:1', wordCount: 1 }], letters, [timed('2:1', [0, 0], [6.7, 9.4], [[0, 6.8, 9.3]])]);
    expect(said![0].wordTimings![0].start).toBe(0.677);
  });
});

/** Al-Tablawi's 32:14 and what the recording says about it, for the tests of the phoneme model's silences. */
const tablawi32_14 = () => {
  // Al-Tablawi's 32:14, as in the test above: the aligner's words, with the level meter hearing nothing between 28 and 30s.
  const published = new Map([['32:14', { from: 18521, to: 37042, segments: [[1, 18591, 19531], [2, 19541, 20101],
    [3, 20111, 20921], [4, 20931, 23301], [5, 23311, 24241], [6, 24251, 24751], [7, 24761, 27851], [8, 27861, 29131],
    [9, 29141, 30131], [10, 30141, 30871], [11, 30881, 31701], [12, 31711, 32221], [13, 32231, 33781], [14, 33791, 36401]] }]]);
  const text = ['فَذُوقُوا۟', 'بِمَا', 'نَسِيتُمْ', 'لِقَآءَ', 'يَوْمِكُمْ', 'هَـٰذَآ', 'إِنَّا', 'نَسِينَـٰكُمْ ۖ', 'وَذُوقُوا۟', 'عَذَابَ', 'ٱلْخُلْدِ', 'بِمَا', 'كُنتُمْ', 'تَعْمَلُونَ'];
  const ayah = [{ verseKey: '32:14', wordCount: 14, words: text }];
  const first: [number, number, number][] = [[0, 18.77, 19.46], [1, 19.73, 19.86], [2, 20.25, 20.97], [3, 21.21, 23.2], [4, 23.45, 24.0],
    [5, 24.49, 24.88], [6, 26.85, 27.51], [7, 28.01, 28.87]];
  const rest: [number, number, number][] = [[8, 29.37, 30.06], [9, 30.29, 30.86], [10, 31.05, 31.82], [11, 31.81, 32.14],
    [12, 32.45, 33.73], [13, 34.01, 35.01]];
  const cut = [timed('32:14', [0, 7], [18.41, 29.03], first), timed('32:14', [8, 13], [29.03, 36.82], rest)];
  const quiet: [number, number][] = [[18.88, 19.28], [20.32, 20.94], [23.74, 24.14], [31.04, 31.38], [31.5, 31.74], [32.26, 32.68],
    [33.48, 33.94], [36.38, 37.28]];

  // A little quiet there, too little for a breath (0.25s, 0.23s of it outside the words).
  const dipped: [number, number][] = [...quiet, [28.85, 29.1]];
  return { published, text, ayah, first, rest, cut, quiet, dipped };
};

describe("the phoneme model's silences at a stop sign (2026-10-15)", () => {
  const { published, ayah, first, rest, cut, quiet, dipped } = tablawi32_14();

  it('splits where the model heard nothing said for 0.4s and the level dipped, though neither was a stop alone', () => {
    expect(phrasesFromPublished(ayah, published, cut, { quiet: dipped })!.map(words)).toEqual([['32:14', 0, 13]]);
    expect(phrasesFromPublished(ayah, published, cut, { quiet: dipped, silences: [[28.9, 29.4]] })!.map(words))
      .toEqual([['32:14', 0, 7], ['32:14', 8, 13]]);
    expect(phrasesFromPublished(ayah, published, cut, { quiet: dipped, silences: [[28.95, 29.15]] })!.map(words)).toEqual([['32:14', 0, 13]]);
  });

  it("does not split on the model's silence where the level never dropped: a vowel held (Al-Tablawi's 21:90, «وَرَهَبًا ۖ»)", () => {
    expect(phrasesFromPublished(ayah, published, cut, { quiet, silences: [[28.6, 29.36]] })!.map(words)).toEqual([['32:14', 0, 13]]);
  });

  it('splits at a stop sign the aligner did not cut at, only on that silence', () => {
    const uncut = [timed('32:14', [0, 13], [18.41, 36.82], [...first, ...rest])];
    expect(phrasesFromPublished(ayah, published, uncut, { quiet: dipped, silences: [[28.9, 29.4]] })!.map(words))
      .toEqual([['32:14', 0, 7], ['32:14', 8, 13]]);
    expect(phrasesFromPublished(ayah, published, uncut, { quiet: dipped, silences: [[28.95, 29.15]] })!.map(words)).toEqual([['32:14', 0, 13]]);
    expect(phrasesFromPublished(ayah, published, uncut, { quiet, silences: [[28.9, 29.4]] })!.map(words)).toEqual([['32:14', 0, 13]]);
    // Nor anywhere without a stop sign, however long the silence: لِقَآءَ | يَوْمِكُمْ.
    expect(phrasesFromPublished(ayah, published, uncut, { quiet, silences: [[23.2, 24.3]] })!.map(words)).toEqual([['32:14', 0, 13]]);
    // Nor with the level meter's quiet alone (Al-Sudais's 2:257 «ٱلنَّارِ ۖ», run on through 0.47s of it).
    expect(phrasesFromPublished(ayah, published, uncut, { quiet: [...quiet, [28.8, 29.4]], silences: [[28.95, 29.15]] })!.map(words))
      .toEqual([['32:14', 0, 13]]);
  });

});

describe("the phoneme model's silences: sung, and the join's own words (2026-10-15)", () => {
  const { published, ayah, first, rest, cut, quiet } = tablawi32_14();

  it('asks a sung recitation for a far longer silence: a held note leaves a second or two', () => {
    const later = rest.map(([index, start, end]): [number, number, number] => [index, start + 2.5, end + 2.5]);
    const sungCut = [timed('32:14', [0, 7], [18.41, 31.53], first), timed('32:14', [8, 13], [31.53, 39.32], later)];
    expect(phrasesFromPublished(ayah, published, sungCut, { quiet, silences: [[28.9, 30.0]], sung: true })!.map(words))
      .toEqual([['32:14', 0, 13]]);
    expect(phrasesFromPublished(ayah, published, sungCut, { quiet, silences: [[28.9, 31.6]], sung: true })!.map(words))
      .toEqual([['32:14', 0, 7], ['32:14', 8, 13]]);
  });

  it("reads the join's edges from the ayah's own words, not another ayah's word of the same number (Al-Sudais's 39:53)", () => {
    // The aligner gave وَذُوقُوا۟ 20ms, too little to be an edge; 32:15's ninth word is no stand-in for it.
    const sliver = [cut[0], timed('32:14', [8, 13], [29.03, 36.82], [[8, 29.37, 29.39], ...rest.slice(1)]),
      timed('32:15', [8, 8], [40.0, 41.0], [[8, 40.0, 40.6]])];
    expect(phrasesFromPublished(ayah, published, sliver, { quiet, silences: [[28.95, 29.15], [37.0, 39.5]] })!.map(words))
      .toEqual([['32:14', 0, 13]]);
  });
});

describe("the user's ground truth for the Quran Foundation's ayah files (2026-10-15): repeat edges", () => {
  it("adds no repeat the aligner made by splitting one long word in two (Abdul Basit's Mujawwad 67:2, أَحْسَنُ)", () => {
    const published = new Map([['67:2', { from: 20637, to: 51827, segments: [[1, 22687, 23857], [2, 23867, 24907], [3, 24917, 26537],
      [4, 26547, 28927], [5, 28937, 31237], [6, 31247, 33897], [7, 33907, 35487], [8, 35497, 38787], [9, 44047, 44497],
      [10, 44507, 46367], [11, 46377, 47427]] }]]);
    const aligned = [
      timed('67:2', [0, 7], [20.75, 40.42], [[0, 22.73, 23.7], [1, 24.13, 24.65], [2, 25.25, 26.17], [3, 26.73, 28.72], [4, 29.09, 31.11],
        [5, 32.05, 33.27], [6, 34.17, 34.7], [6, 34.49, 35.42], [7, 35.89, 36.7]]),
      timed('67:2', [8, 10], [40.42, 55.13], [[8, 43.84, 44.44], [9, 44.81, 46.11], [10, 46.77, 54.89]]),
    ];
    const quiet: [number, number][] = [[30.9, 31.1], [34.28, 34.84], [37.26, 43.42], [44.36, 44.72], [47.18, 47.5], [49.88, 54.92]];
    expect(phrasesFromPublished([{ verseKey: '67:2', wordCount: 11 }], published, aligned, { quiet })!.map(words))
      .toEqual([['67:2', 0, 7], ['67:2', 8, 10]]);
  });

  it("adds a repeat whose end touches the next listed word (Al-Sudais's 39:55, مِّن قَبْلِ ... بَغْتَةً twice)", () => {
    const published = new Map([['39:55', { from: 36754, to: 52950, segments: [[1, 37500, 38410], [2, 38420, 38890], [3, 38900, 39200],
      [4, 39210, 39750], [5, 39760, 40280], [6, 40290, 40630], [7, 40640, 41660], [8, 41670, 41900], [9, 41910, 42320],
      [10, 42330, 42530], [11, 42540, 43370], [12, 43380, 44360], [13, 44370, 49890], [14, 49900, 50930], [15, 50940, 51180],
      [16, 51190, 52530]] }]]);
    const aligned = [
      timed('39:55', [0, 12], [37.02, 45.72], [[0, 37.65, 38.34], [1, 38.49, 38.89], [2, 39.03, 39.05], [3, 39.33, 39.85],
        [4, 39.89, 40.49], [5, 40.69, 40.89], [6, 41.09, 41.61], [7, 41.96, 42.09], [8, 42.28, 42.49], [9, 42.53, 42.73],
        [10, 42.92, 43.69], [11, 43.73, 44.41], [12, 44.53, 45.12]]),
      timed('39:55', [7, 15], [45.72, 52.95], [[7, 46.52, 46.64], [8, 46.84, 47.12], [9, 47.29, 47.44], [10, 47.71, 48.48],
        [11, 48.57, 49.12], [12, 49.29, 49.91], [13, 50.35, 50.87], [14, 51.09, 51.19], [15, 51.37, 52.87]], 'restarted phrase'),
    ];
    const quiet: [number, number][] = [[40.94, 41.28], [41.94, 42.14], [45.06, 46.4], [49.46, 49.72], [52.56, 52.94]];
    expect(phrasesFromPublished([{ verseKey: '39:55', wordCount: 16 }], published, aligned, { quiet })!.map(words))
      .toEqual([['39:55', 0, 12], ['39:55', 7, 15]]);
  });
});

describe('repeats in a built-in reciter passage', () => {
  /** A segment of one ayah's words `first`-`last` (0-based), at seconds `startTime`-`endTime`. */
  const seg = (verseKey: string, startTime: number, endTime: number, first = 0, last = 9) =>
    ({ verseKey, startTime, endTime, startWordIndex: first, endWordIndex: last });
  const passage = (...keys: [string, number][]) => keys.map(([verseKey, wordCount]) => ({ verseKey, wordCount }));

  it('are the aligner’s segments from going back to an ayah already read through, until a new one (Al-Ajmy 59:18-21)', () => {
    const segments = [seg('59:18', 0, 20), seg('59:19', 21, 36), seg('59:20', 36, 54),
      seg('59:18', 57, 76), seg('59:19', 76, 92), seg('59:20', 92, 109), seg('59:21', 109, 140)];
    const { repeats, rest } = goingBack(segments, passage(['59:18', 10], ['59:19', 10], ['59:20', 10], ['59:21', 10]));
    expect(repeats.map(r => [r.verseKey, r.startTime, r.repeat])).toEqual([['59:18', 57, true], ['59:19', 76, true], ['59:20', 92, true]]);
    expect(rest.map(r => r.verseKey)).toEqual(['59:18', '59:19', '59:20', '59:21']);
  });

  it('folds a sliver of a repeat into the repeat before it', () => {
    const segments = [seg('59:19', 0, 10), seg('59:20', 10, 20), seg('59:19', 21, 30), seg('59:19', 30, 30.3, 4, 4), seg('59:20', 30.3, 40)];
    const { repeats } = goingBack(segments, passage(['59:19', 10], ['59:20', 10]));
    expect(repeats.map(r => [r.verseKey, r.startTime, r.endTime])).toEqual([['59:19', 21, 30.3], ['59:20', 30.3, 40]]);
  });

  it('leaves a restart inside the ayah being read with the rest', () => {
    const segments = [seg('2:255', 0, 10, 0, 30), seg('2:255', 10, 14, 25, 49), seg('2:256', 14, 30)];
    expect(goingBack(segments, passage(['2:255', 50], ['2:256', 10]))).toEqual({ repeats: [], rest: segments });
  });

  it('takes no ayah read over another’s words for a repeat (Al-Tunaiji 23:87, read as 23:85 from its third word)', () => {
    const segments = [seg('23:86', 0, 7, 0, 7), seg('23:87', 7, 11, 0, 1), seg('23:85', 11, 15, 2, 4)];
    expect(goingBack(segments, passage(['23:86', 8], ['23:87', 5])).repeats).toEqual([]);
  });

  it('are captions of their own, in time order, the caption before ending where one starts', () => {
    const captions = [seg('78:35', 0, 6), seg('78:36', 6, 28)];
    const repeats = [{ ...seg('78:35', 14.3, 20), repeat: true }, { ...seg('78:36', 20.4, 27.8), repeat: true }];
    expect(withRepeats(captions, repeats).map(c => [c.verseKey, c.startTime, c.endTime, Boolean(c.repeat)])).toEqual([
      ['78:35', 0, 6, false], ['78:36', 6, 14.3, false], ['78:35', 14.3, 20, true], ['78:36', 20.4, 27.8, true],
    ]);
    expect(withRepeats(captions, [])).toBe(captions);
  });
});
