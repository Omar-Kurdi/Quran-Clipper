import { describe, expect, it } from 'vitest';
import type { VerseData } from './quranData';
import {
  clipFromMap, coverage, holdAcrossJoin, matchesInParts, MAP_IN_PARTS_SEC, mergeIntoGaps, mergeWindowTimeline, nudgedStretch, planMapWindows, seedFromClips, windowsToMatch, writeClipToMap,
} from './ayahMap';

const verse = (verseKey: string, startTime: number, endTime: number, textUthmani = 'أ ب ج'): VerseData => ({
  verseNumber: Number(verseKey.split(':')[1]),
  verseKey,
  textUthmani,
  translation: 'text',
  startTime,
  endTime,
});
const keys = (verses: VerseData[]) => verses.map(v => [v.verseKey, v.startTime, v.endTime]);

describe('planMapWindows', () => {
  it('cuts a long recording into stretches of about the window, each ending in the longest pause near its end', () => {
    const pauses = [{ start: 260, end: 261 }, { start: 280, end: 283 }, { start: 545, end: 546 }];
    expect(planMapWindows(800, pauses, 270)).toEqual([{ start: 0, end: 281.5 }, { start: 281.5, end: 545.5 }, { start: 545.5, end: 800 }]);
  });

  it('cuts where planned when no pause is near, and joins a short last stretch to the one before', () => {
    expect(planMapWindows(600, [], 270)).toEqual([{ start: 0, end: 270 }, { start: 270, end: 600 }]);
  });

  it('is one stretch for a recording shorter than a window', () => {
    expect(planMapWindows(200, [], 270)).toEqual([{ start: 0, end: 200 }]);
  });
});

describe('coverage and windowsToMatch', () => {
  it('measures how much of a stretch captions cover, overlaps counted once', () => {
    expect(coverage([verse('3:1', 0, 50), verse('3:2', 40, 60)], { start: 0, end: 100 })).toBeCloseTo(0.6);
  });

  it('leaves out a stretch already captioned, from an earlier run or a checked clip', () => {
    const windows = [{ start: 0, end: 100 }, { start: 100, end: 200 }];
    expect(windowsToMatch(windows, [verse('3:1', 0, 95)])).toEqual([{ start: 100, end: 200 }]);
  });
});

describe('mergeIntoGaps', () => {
  it('keeps every existing caption as it is, and adds a match only where none is', () => {
    const map = [verse('3:14', 235.6, 248.7, 'checked')];
    const matched = [verse('3:13', 220, 235.5), verse('3:14', 236, 249, 'fresh'), verse('3:15', 249, 262)];
    const merged = mergeIntoGaps(map, matched);
    expect(keys(merged)).toEqual([['3:13', 220, 235.5], ['3:14', 235.6, 248.7], ['3:15', 249, 262]]);
    expect(merged[1].textUthmani).toBe('checked');
  });
});

describe('mergeWindowTimeline', () => {
  const clip1 = [verse('2:1', 10, 12), verse('2:2', 12, 20)];

  it("leaves another clip's captions alone when a second clip is matched", () => {
    const merged = mergeWindowTimeline(clip1, [verse('2:30', 600, 610)], { start: 595, end: 615 });
    expect(keys(merged)).toEqual([['2:1', 10, 12], ['2:2', 12, 20], ['2:30', 600, 610]]);
  });

  it('replaces what the stretch held before, and cuts back one reaching into it', () => {
    const before = [verse('2:1', 0, 11), verse('2:2', 11, 20), verse('2:3', 20, 40)];
    const merged = mergeWindowTimeline(before, [verse('2:2', 12, 19.5)], { start: 10, end: 30 });
    expect(keys(merged)).toEqual([['2:1', 0, 10], ['2:2', 12, 19.5], ['2:3', 30, 40]]);
  });

  it('keeps everything when the match found nothing', () => {
    expect(mergeWindowTimeline(clip1, [], { start: 0, end: 100 })).toBe(clip1);
  });
});

describe('a clip and the map', () => {
  const map = [verse('3:13', 220, 235.6), verse('3:14', 235.6, 248.7), verse('3:15', 248.7, 262), verse('3:16', 262, 280)];
  const window = { start: 235.6, end: 262 };

  it("gives a clip the map's captions in its stretch, on its own clock", () => {
    expect(keys(clipFromMap(map, window))).toEqual([['3:14', 0, 13.1], ['3:15', 13.1, 26.4]]);
  });

  it('writes a fix made in the clip back into the map, the rest of the map untouched', () => {
    const fixed = [verse('3:14', 0, 12.5, 'fixed'), verse('3:15', 12.5, 26.4)];
    const written = writeClipToMap(map, fixed, window);
    expect(keys(written)).toEqual([['3:13', 220, 235.6], ['3:14', 235.6, 248.1], ['3:15', 248.1, 262], ['3:16', 262, 280]]);
    expect(written[1].textUthmani).toBe('fixed');
  });

  it("seeds an empty map from clips captioned already, on the recording's clock", () => {
    const seeded = seedFromClips([], [{ verses: [verse('3:14', 0, 13.1)], window }]);
    expect(keys(seeded)).toEqual([['3:14', 235.6, 248.7]]);
  });
});

describe('nudgedStretch', () => {
  // Four ayahs with a second of pause between each.
  const map = [verse('3:13', 10, 20), verse('3:14', 21, 30), verse('3:15', 31, 40), verse('3:16', 41, 50)];
  const clip = { start: 20.5, end: 40.5 }; // 3:14-15

  it('takes in the ayah before or after, opening and closing in the pauses', () => {
    expect(nudgedStretch(map, clip, 'start', -1, 60)).toEqual({ start: 9.5, end: 40.5 });
    expect(nudgedStretch(map, clip, 'end', 1, 60)).toEqual({ start: 20.5, end: 50.5 });
  });

  it('lets its first or last ayah go', () => {
    expect(nudgedStretch(map, clip, 'start', 1, 60)).toEqual({ start: 30.5, end: 40.5 });
    expect(nudgedStretch(map, clip, 'end', -1, 60)).toEqual({ start: 20.5, end: 30.5 });
  });

  it('gives nothing past the recording\'s ayahs, or a clip of none', () => {
    expect(nudgedStretch(map, { start: 9.5, end: 20.5 }, 'start', -1, 60)).toBeNull();
    expect(nudgedStretch(map, { start: 20.5, end: 30.5 }, 'end', -1, 60)).toBeNull();
  });
});

describe('matchesInParts', () => {
  it('matches in parts only what is more than one part long', () => {
    expect(matchesInParts(MAP_IN_PARTS_SEC)).toBe(false);
    expect(planMapWindows(MAP_IN_PARTS_SEC, [])).toHaveLength(1);
    expect(matchesInParts(MAP_IN_PARTS_SEC + 1)).toBe(true);
    expect(planMapWindows(MAP_IN_PARTS_SEC + 1, []).length).toBeGreaterThan(1);
  });

  it('is never true of a length not known', () => {
    expect(matchesInParts(NaN)).toBe(false);
    expect(matchesInParts(Infinity)).toBe(false);
  });
});

describe('holdAcrossJoin', () => {
  // As-Sajdah 32:20 matched in two parts cut at 290.7 s: 288.1-293.48 showed nothing.
  it('holds the caption before a join until the next starts', () => {
    const map = [verse('32:20', 268.9, 288.1), verse('32:20', 293.48, 307.08)];
    expect(keys(holdAcrossJoin(map, 290.7))).toEqual([['32:20', 268.9, 293.48], ['32:20', 293.48, 307.08]]);
  });

  it('leaves a long gap, and a join with nothing on one side', () => {
    const long = [verse('32:20', 268.9, 280), verse('32:21', 295, 300)];
    expect(keys(holdAcrossJoin(long, 290))).toEqual(keys(long));
    const alone = [verse('32:20', 268.9, 288.1)];
    expect(keys(holdAcrossJoin(alone, 290))).toEqual(keys(alone));
  });

  it('changes nothing where the captions already meet', () => {
    const met = [verse('32:20', 268.9, 290.7), verse('32:21', 290.7, 300)];
    expect(keys(holdAcrossJoin(met, 290.7))).toEqual(keys(met));
  });
});
