import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPrimaryTimelineSummary,
  trimTimeline,
  enforceTimelineOrder,
  parseVerseKey,
  estimateDurationFromSegments,
  fetchVersesByDetectedSegments,
} from './matchTimeline';

// One ayah, four words, so a segment can cover part of it and a restart can
// cover an overlapping part later in the recording.
vi.mock('./quranCorpus', () => ({
  getVerseByKey: async (verseKey: string) => ({
    verseNumber: Number(verseKey.split(':')[1]),
    verseKey,
    textUthmani: 'أ ب ج د',
    translation: 'text',
    words: ['أ', 'ب', 'ج', 'د'].map(arabic => ({ arabic, translation: '' })),
  }),
}));
import type { VerseData } from './quranData';

const verse = (verseKey: string, startTime: number, endTime: number): VerseData => ({
  verseNumber: Number(verseKey.split(':')[1]),
  verseKey,
  textUthmani: 'نص',
  translation: 'text',
  startTime,
  endTime,
});

describe('getPrimaryTimelineSummary', () => {
  it('returns the surah name alone, with no range baked into it', () => {
    // The bug this pins: it used to return the *timeline title* here, so
    // everything downstream asking "which surah" got "At-Tahrim 1-12" and then
    // appended its own range -- a badge reading `At-Tahrim 1-12 (66:6-8)` and a
    // filename carrying the range twice.
    const summary = getPrimaryTimelineSummary(
      [{ verseKey: '66:6' }, { verseKey: '66:7' }, { verseKey: '66:8' }],
      66
    );
    expect(summary.surahNameEnglish).toBe('At-Tahrim');
    expect(summary.surahNameEnglish).not.toMatch(/\d/);
  });

  it('still offers the matched span separately, as timelineTitle', () => {
    const summary = getPrimaryTimelineSummary([{ verseKey: '66:6' }, { verseKey: '66:8' }], 66);
    expect(summary.timelineTitle).toBe('At-Tahrim 6-8');
  });

  it('reports the range actually present, not the surah it belongs to', () => {
    const summary = getPrimaryTimelineSummary([{ verseKey: '66:6' }, { verseKey: '66:8' }], 66);
    expect([summary.surahNumber, summary.ayahStart, summary.ayahEnd]).toEqual([66, 6, 8]);
  });

  it('names a multi-surah timeline without pretending it is one surah', () => {
    const summary = getPrimaryTimelineSummary([{ verseKey: '1:1' }, { verseKey: '2:1' }], 1);
    expect(summary.timelineTitle).toMatch(/2 surahs/);
    expect(summary.surahNameEnglish).not.toBe('Al-Fatihah');
  });

  it('falls back to the selected surah when nothing resolved', () => {
    const summary = getPrimaryTimelineSummary([], 33);
    expect(summary.surahNumber).toBe(33);
    expect(summary.surahNameEnglish).toBe('Al-Ahzab');
  });
});

describe('trimTimeline', () => {
  it('rebases the kept segments so the clip still starts at zero', () => {
    const trimmed = trimTimeline([verse('66:6', 10, 20), verse('66:7', 20, 30)], 10, 30);
    expect(trimmed.map(v => [v.startTime, v.endTime])).toEqual([[0, 10], [10, 20]]);
  });

  it('drops what falls entirely outside the window', () => {
    const trimmed = trimTimeline([verse('66:5', 0, 5), verse('66:6', 10, 20)], 10, 30);
    expect(trimmed.map(v => v.verseKey)).toEqual(['66:6']);
  });

  it('clamps a segment straddling the cut rather than losing the whole ayah', () => {
    const trimmed = trimTimeline([verse('66:6', 5, 20)], 10, 30);
    expect(trimmed[0].startTime).toBe(0);
    expect(trimmed[0].endTime).toBe(10);
  });

  it('never produces a zero-length segment', () => {
    const trimmed = trimTimeline([verse('66:6', 9.95, 10.02)], 10, 30);
    expect(trimmed[0].endTime).toBeGreaterThan(trimmed[0].startTime);
  });
});

describe('enforceTimelineOrder', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('sorts by start time', () => {
    const ordered = enforceTimelineOrder([verse('1:2', 5, 8), verse('1:1', 0, 4)], 20);
    expect(ordered.map(v => v.verseKey)).toEqual(['1:1', '1:2']);
  });

  it('truncates the earlier of two overlapping segments', () => {
    const ordered = enforceTimelineOrder([verse('1:1', 0, 6), verse('1:2', 4, 9)], 20);
    expect(ordered[0].endTime).toBe(4);
  });

  it('clamps a segment running past the end of the audio', () => {
    const ordered = enforceTimelineOrder([verse('1:1', 0, 30)], 10);
    expect(ordered[0].endTime).toBe(10);
  });

  it('drops a segment starting after the audio has ended', () => {
    const ordered = enforceTimelineOrder([verse('1:1', 0, 5), verse('1:2', 40, 45)], 10);
    expect(ordered.map(v => v.verseKey)).toEqual(['1:1']);
  });
});

describe('parseVerseKey', () => {
  it('prefers an explicit key', () => {
    expect(parseVerseKey({ verseKey: '2:255' }, 1)).toBe('2:255');
  });

  it('builds one from the selected surah when only a verse number is given', () => {
    expect(parseVerseKey({ verseNumber: 4 }, 36)).toBe('36:4');
  });

  it('returns null when there is nothing to go on', () => {
    expect(parseVerseKey({}, 1)).toBeNull();
  });
});

describe('estimateDurationFromSegments', () => {
  it('takes the furthest end, not the last element', () => {
    expect(estimateDurationFromSegments([{ endTime: 30 }, { endTime: 12 }])).toBe(30);
  });

  it('is zero for an empty timeline rather than -Infinity', () => {
    expect(estimateDurationFromSegments([])).toBe(0);
  });
});

describe('trimTimeline word times', () => {
  it('moves word times with the segment they belong to', () => {
    // Word times are on the same clock as the segment. Left where they were,
    // they would sit outside the rebased segment, and every consumer that
    // checks whether a time still belongs to its segment would discard them --
    // trimming a clip would silently cost it its per-word timing.
    const timed: VerseData = {
      ...verse('66:8', 30, 40),
      words: [
        { arabic: 'أ', translation: '', timestamp: 31.239 },
        { arabic: 'ب', translation: '', timestamp: 35.582 },
      ],
    };
    const [trimmed] = trimTimeline([timed], 30, 40);
    expect(trimmed.startTime).toBe(0);
    // To the millisecond, not to the segment's one decimal. The aligner reports
    // word times at this precision and it is what makes a split exact; rounding
    // 5.582 to 5.6 would move the cut past a word.
    expect(trimmed.words?.map(w => w.timestamp)).toEqual([1.239, 5.582]);
  });

  it('leaves a word alone when it never had a time', () => {
    const untimed: VerseData = {
      ...verse('66:8', 30, 40),
      words: [{ arabic: 'أ', translation: '' }],
    };
    const [trimmed] = trimTimeline([untimed], 30, 40);
    expect(trimmed.words?.[0].timestamp).toBeUndefined();
  });
});

describe('fetchVersesByDetectedSegments word times', () => {
  it('gives each word the time the provider measured for it', () => {
    return fetchVersesByDetectedSegments({
      segments: [{
        verseKey: '66:8',
        startTime: 0,
        endTime: 4,
        startWordIndex: 0,
        endWordIndex: 1,
        wordTimings: [
          { index: 0, start: 0.5, end: 1.5 },
          { index: 1, start: 2.0, end: 3.5 },
        ],
      }],
      selectedSurah: 66,
      audioDuration: 10,
    }).then(timeline => {
      expect(timeline[0].words?.map(w => w.timestamp)).toEqual([0.5, 2.0, undefined, undefined]);
    });
  });

  it('gives a restart its own times rather than the first reading of them', async () => {
    // The same ayah, recited twice. Both segments name the same word indices,
    // so anything keyed on index alone would let the later reading overwrite
    // the earlier -- and the first caption would carry the second's times.
    const timeline = await fetchVersesByDetectedSegments({
      segments: [
        {
          verseKey: '66:8',
          startTime: 0,
          endTime: 4,
          startWordIndex: 0,
          endWordIndex: 1,
          wordTimings: [{ index: 0, start: 0.5, end: 1.5 }, { index: 1, start: 2.0, end: 3.5 }],
        },
        {
          verseKey: '66:8',
          startTime: 5,
          endTime: 9,
          startWordIndex: 0,
          endWordIndex: 1,
          wordTimings: [{ index: 0, start: 5.5, end: 6.5 }, { index: 1, start: 7.0, end: 8.5 }],
        },
      ],
      selectedSurah: 66,
      audioDuration: 10,
    });
    expect(timeline[0].words?.[0].timestamp).toBe(0.5);
    expect(timeline[1].words?.[0].timestamp).toBe(5.5);
  });

  it('leaves words untimed when the provider measured nothing', async () => {
    // Gemini estimates a segment span and nothing finer. Inventing a time per
    // word from it would look like a measurement and read like one downstream.
    const timeline = await fetchVersesByDetectedSegments({
      segments: [{ verseKey: '66:8', startTime: 0, endTime: 4, startWordIndex: 0, endWordIndex: 3 }],
      selectedSurah: 66,
      audioDuration: 10,
    });
    expect(timeline[0].words?.every(w => w.timestamp === undefined)).toBe(true);
  });
});
