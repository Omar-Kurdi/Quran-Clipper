import { describe, it, expect } from 'vitest';
import type { MatchSegment } from './matchTypes';
import { heardOffset, phrasesFromPublished, publishedAyahBounds, soundTimings, timedFromPublished } from './publishedPhrases';

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
    expect(ayah6.map(caption => [caption.startTime, caption.endTime])).toEqual([[100.04, 115.09], [115.09, 137.19], [137.19, 143.81]]);
    expect(ayah6[1].notes).toBe('restarted phrase');
    // The repeat carries the times of its own reading, not the first one's.
    expect(ayah6[1].wordTimings?.[0]).toEqual({ index: 7, start: 115.09, end: 116.72 });
  });

  it('ignores a cut nowhere near where the published timings put that boundary', () => {
    const marked = [{ ...passage[0], words: text12v3.map((word, i) => (i === 4 ? `${word} ۚ` : word)) }];
    const far = [seg('12:3', 0, 4, 35.6, 45), seg('12:3', 5, 15, 45, 58)];
    expect(phrasesFromPublished(marked, published, far)!.map(words)).toEqual([['12:3', 0, 15]]);
    const near = [seg('12:3', 0, 4, 35.6, 39.3), seg('12:3', 5, 15, 39.3, 58)];
    expect(phrasesFromPublished(marked, published, near)!.map(words)).toEqual([['12:3', 0, 4], ['12:3', 5, 15]]);
  });

  it('cuts nowhere the mushaf has no stop sign, however near the published boundary the aligner heard quiet', () => {
    // Was a cut before 2026-10-08. Al-Muaiqly's 1:7 was split after وَلَا, on
    // the published boundary, at a held consonant the aligner took for a pause.
    const near = [seg('12:3', 0, 4, 35.6, 39.3), seg('12:3', 5, 15, 39.3, 58)];
    expect(phrasesFromPublished(passage.slice(0, 1), published, near)!.map(words)).toEqual([['12:3', 0, 15]]);
    const fatihah7 = new Map([['1:7', { from: 45100, to: 60300, segments: [[1, 45280, 46250], [2, 46250, 47260], [3, 47260, 48280], [4, 48280, 49360], [5, 49360, 50070], [6, 50070, 51250], [7, 51250, 52330], [8, 52330, 52760], [9, 52760, 60300]] }]]);
    const text = ['صِرَٰطَ', 'ٱلَّذِينَ', 'أَنْعَمْتَ', 'عَلَيْهِمْ', 'غَيْرِ', 'ٱلْمَغْضُوبِ', 'عَلَيْهِمْ', 'وَلَا', 'ٱلضَّآلِّينَ'];
    const heard = [seg('1:7', 0, 7, 44.92, 52.82), seg('1:7', 8, 8, 52.82, 62.59)];
    expect(phrasesFromPublished([{ verseKey: '1:7', wordCount: 9, words: text }], fatihah7, heard)!.map(words)).toEqual([['1:7', 0, 8]]);
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

describe('soundTimings', () => {
  const ayah = (from: number, to: number, words: number[][] = []) => ({ timing: { from, to, segments: words }, wordCount: Math.max(1, words.length) });

  it('believes timings that run forward, a little overlap allowed', () => {
    expect(soundTimings([ayah(0, 5000, [[1, 0, 5000]]), ayah(4900, 9000, [[1, 4900, 9000]])])).toBe(true);
  });

  it("refuses the ones past saving: an ayah 0.02s long, one listed a minute early, words outside their ayah", () => {
    // Al-Rifai's 8:61, Abdul Basit's 55:70-71.
    expect(soundTimings([ayah(1146867, 1201824), ayah(1201832, 1201853)])).toBe(false);
    expect(soundTimings([ayah(606317, 613239), ayah(548421, 555695)])).toBe(false);
    expect(soundTimings([ayah(0, 5000, [[1, 60000, 61000], [2, 61000, 62000]])])).toBe(false);
    expect(soundTimings([{ timing: null, wordCount: 3 }])).toBe(false);
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

describe('published timings off against the recording', () => {
  // Hani al-Rifai's 54:31 as QUL times it, and where the aligner heard its words: 1.6s later throughout.
  const qul54v31 = { from: 212188, to: 226128, segments: [[1, 212190, 213520], [2, 213520, 214660], [3, 214660, 215560], [4, 215560, 217010]] };
  const heardAt = (offsets: number[]) => [{
    verseKey: '54:31', startWordIndex: 0, endWordIndex: 3, startTime: 213.8, endTime: 226,
    wordTimings: offsets.map((off, index) => ({ index, start: qul54v31.segments[index][1] / 1000 + off, end: 0 })),
  }];

  it("moves an ayah whose every word is heard late by the same amount (Al-Rifai's 54:31, 1.6s)", () => {
    expect(heardOffset(heardAt([1.6, 1.62, 1.55, 1.6]), '54:31', qul54v31)).toBeCloseTo(1600, -1);
    const [caption] = phrasesFromPublished(
      [{ verseKey: '54:31', wordCount: 4 }], new Map([['54:31', qul54v31]]), heardAt([1.6, 1.62, 1.55, 1.6]), { drifts: true }
    )!;
    expect(caption.startTime).toBeCloseTo(213.79, 1);
  });

  it('starts a moved ayah no later than its first word was heard, where the drift begins inside it (24:58)', () => {
    // Al-Rifai's 24:58 as QUL times its first eight words: the first heard 0.37s after published, the rest 2s.
    const starts = [1370922, 1375102, 1376132, 1376712, 1378612, 1379782, 1380162, 1380972];
    const qul24v58 = { from: 1370922, to: 1384092, segments: starts.map((start, i) => [i + 1, start, starts[i + 1] ?? 1384092]) };
    const late = [0.37, 2.04, 2.1, 2.06, 2.0, 2.03, 2.09, 2.08];
    const heard = [{
      verseKey: '24:58', startWordIndex: 0, endWordIndex: 7, startTime: 1371.2, endTime: 1386,
      wordTimings: late.map((off, index) => ({ index, start: starts[index] / 1000 + off, end: 0 })),
    }];
    const [caption] = phrasesFromPublished([{ verseKey: '24:58', wordCount: 8 }], new Map([['24:58', qul24v58]]), heard, { drifts: true })!;
    expect(caption.startTime).toBeCloseTo(1371.292, 2);
  });

  it('moves no ayah of an export not known to drift, however consistently the aligner hears it late', () => {
    // Yasser ad-Dossary's 2:35: quran.com times it right, and the aligner heard every word 0.94s late.
    const [caption] = phrasesFromPublished([{ verseKey: '54:31', wordCount: 4 }], new Map([['54:31', qul54v31]]), heardAt([0.94, 0.95, 0.93, 0.94]))!;
    expect(caption.startTime).toBe(212.188);
  });

  it("leaves it where the words agree by little, disagree among themselves, or are a whole ayah apart", () => {
    expect(heardOffset(heardAt([0.15, 0.2, 0.1, 0.18]), '54:31', qul54v31)).toBe(0);
    expect(heardOffset(heardAt([1.6, -0.4, 2.2, 0.1]), '54:31', qul54v31)).toBe(0);
    expect(heardOffset(heardAt([7.6, 7.6, 7.5, 7.7]), '54:31', qul54v31)).toBe(0);
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

describe('a measured stretch the reciter read on into and went back over', () => {
  // Khalid al-Jalil's 82:16-20, shortened: QUL gives 82:17-19 one span each; he reads 17 18 19, then 17 18 19 again.
  const qul = new Map([
    ['82:16', { from: 80465, to: 87000, segments: [[1, 80565, 87000]] }],
    ['82:17', { from: 97943, to: 112198, segments: [[1, 98043, 112198]] }],
    ['82:18', { from: 112338, to: 128835, segments: [[1, 112338, 128835]] }],
    ['82:19', { from: 129016, to: 145813, segments: [[1, 129016, 145813]] }],
    ['82:20', { from: 146000, to: 150000, segments: [[1, 146000, 150000]] }],
  ]);
  const stretch = (verseKey: string, startTime: number, endTime: number) =>
    ({ verseKey, verseNumber: Number(verseKey.split(':')[1]), startTime, endTime, startWordIndex: 0, endWordIndex: 0, confidence: 1 });
  const regions = [{ ayahs: [17, 19], audioUrl: 'x', segments: [
    stretch('82:17', 87.27, 100), stretch('82:18', 100, 107.49), stretch('82:19', 107.49, 114.53),
    stretch('82:17', 114.53, 122.51), stretch('82:18', 122.51, 129), stretch('82:19', 129, 146),
  ] }];
  const passage = [16, 17, 18, 19, 20].map(n => ({ verseKey: `82:${n}`, wordCount: 1 }));

  it('captions it as recited, and the ayahs around it as published', () => {
    const captions = phrasesFromPublished(passage, qul, [], { regions })!;
    expect(captions.map(c => [c.verseKey, c.startTime])).toEqual([
      ['82:16', 80.465], ['82:17', 87.27], ['82:18', 100], ['82:19', 107.49],
      ['82:17', 114.53], ['82:18', 122.51], ['82:19', 129], ['82:20', 146],
    ]);
    expect(captions[0].endTime).toBe(87);
  });

  it('loads each of its ayahs up to where the next first begins', () => {
    const bounds = publishedAyahBounds(passage, qul, regions)!;
    expect(bounds.get('82:17')).toEqual({ start: 87.27, end: 100 });
    expect(bounds.get('82:19')).toEqual({ start: 107.49, end: 146 });
  });
});
