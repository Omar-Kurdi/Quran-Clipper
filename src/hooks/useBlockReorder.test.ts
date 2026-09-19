import { describe, it, expect } from 'vitest';
import { dropIndex, dropMarker } from './useBlockReorder';
import { reorder } from '@/lib/verseEdits';
import type { VerseData } from '@/lib/quranData';

/** Four captions, back to back: 0-4, 4-6, 6-12, 12-14. */
const spans = [
  { startTime: 0, endTime: 4 },
  { startTime: 4, endTime: 6 },
  { startTime: 6, endTime: 12 },
  { startTime: 12, endTime: 14 }
];

describe('dropIndex', () => {
  it('puts a block before whichever block it is dropped on the first half of', () => {
    // Dragging the last caption onto the first half of the first.
    expect(dropIndex(spans, 3, 1)).toBe(0);
    // ...and onto the second half of the first: after it.
    expect(dropIndex(spans, 3, 3)).toBe(1);
  });

  it('counts positions without the dragged block, as reorder does', () => {
    // The first caption dropped past everything lands last.
    expect(dropIndex(spans, 0, 13.5)).toBe(3);
  });

  it('leaves a block where it is when dropped on itself', () => {
    expect(dropIndex(spans, 2, 9)).toBe(2);
  });
});

describe('dropMarker', () => {
  it('marks the start of the block the drop will sit before', () => {
    expect(dropMarker(spans, 3, 0)).toBe(0);
    expect(dropMarker(spans, 3, 1)).toBe(4);
  });

  it('marks the end of the last block for a drop at the end', () => {
    expect(dropMarker(spans, 0, 3)).toBe(14);
  });
});

describe('a drag, end to end', () => {
  it('moves the caption and re-seats the timeline in the new order', () => {
    const verses = spans.map((span, i) => ({ verseKey: `1:${i + 1}`, verseNumber: i + 1, ...span })) as VerseData[];
    const to = dropIndex(spans, 3, 1);
    const moved = reorder(verses, 3, to);
    expect(moved.map(v => v.verseKey)).toEqual(['1:4', '1:1', '1:2', '1:3']);
    // Durations kept, laid end to end from the first start.
    expect(moved.map(v => [v.startTime, v.endTime])).toEqual([[0, 2], [2, 6], [6, 8], [8, 14]]);
  });
});
