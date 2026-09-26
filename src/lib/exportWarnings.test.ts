import { describe, it, expect } from 'vitest';
import { laneGaps, backgroundsIn, exportWarnings } from './exportWarnings';

const lane = [
  { url: 'a.mp4', start: 0, end: 4 },
  { url: 'b.mp4', start: 6, end: 10 },
  { url: 'a.mp4', start: 10, end: 12 },
];

describe('laneGaps', () => {
  it('finds a hole between two blocks, on the render clock', () => {
    expect(laneGaps(lane, 2, 12)).toEqual([{ start: 2, end: 4 }]);
  });

  it('finds an uncovered tail and head', () => {
    expect(laneGaps(lane, 0, 15)).toEqual([{ start: 4, end: 6 }, { start: 12, end: 15 }]);
    expect(laneGaps([{ url: 'a', start: 3, end: 9 }], 1, 9)).toEqual([{ start: 0, end: 2 }]);
  });

  it('ignores a seam too short to see', () => {
    expect(laneGaps([{ url: 'a', start: 0, end: 5 }, { url: 'b', start: 5.04, end: 9 }], 0, 9)).toEqual([]);
  });

  it('reports the whole range for an empty lane', () => {
    expect(laneGaps([], 1, 4)).toEqual([{ start: 0, end: 3 }]);
  });

  it('does not count overlapping blocks as a gap', () => {
    expect(laneGaps([{ url: 'a', start: 0, end: 6 }, { url: 'b', start: 2, end: 4 }, { url: 'c', start: 6, end: 8 }], 0, 8)).toEqual([]);
  });
});

describe('backgroundsIn', () => {
  it('lists each background drawn in the range once', () => {
    expect(backgroundsIn(lane, 0, 12)).toEqual(['a.mp4', 'b.mp4']);
    expect(backgroundsIn(lane, 6, 9)).toEqual(['b.mp4']);
  });
});

describe('exportWarnings', () => {
  const base = { segments: lane, start: 0, end: 12, offline: true };

  it('says nothing when every background reads and the lane is whole', () => {
    expect(exportWarnings({ ...base, segments: [{ url: 'a.mp4', start: 0, end: 12 }], handCut: true, reads: { 'a.mp4': 'decoder' } })).toEqual([]);
  });

  it('puts gaps first, then backgrounds that will not read well', () => {
    const warnings = exportWarnings({ ...base, handCut: true, reads: { 'a.mp4': 'unreadable', 'b.mp4': 'seeking' } });
    expect(warnings).toEqual([
      { kind: 'gap', start: 4, end: 6 },
      { kind: 'unreadable', url: 'a.mp4' },
      { kind: 'seeking', url: 'b.mp4' },
    ]);
  });

  it('reports gaps only for a hand-cut lane', () => {
    expect(exportWarnings({ ...base, handCut: false, reads: {} })).toEqual([]);
  });

  it('does not mention seeking for a recorded render', () => {
    expect(exportWarnings({ ...base, handCut: false, offline: false, reads: { 'b.mp4': 'seeking' } })).toEqual([]);
  });

  it('waits quietly for a background still being probed', () => {
    expect(exportWarnings({ ...base, handCut: false, reads: { 'a.mp4': 'decoder' } })).toEqual([]);
  });
});
