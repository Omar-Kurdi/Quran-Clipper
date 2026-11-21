import { describe, it, expect } from 'vitest';
import { clipWindow, timelineView, playFrom, pastClipEnd, VIEW_MARGIN_SEC } from './clipWindow';

// Ar-Ra'd 3-12 from Maher's chapter file, the case that was reported: the
// passage starts 86.8s into a 1330s recording.
const range = { start: 86.8, end: 400 };

describe('clipWindow', () => {
  it("is the reciter's passage inside the chapter", () => {
    expect(clipWindow(range, 1330, false)).toEqual({ start: 86.8, end: 400 });
  });

  it('is nothing for an upload, whose file is the clip', () => {
    expect(clipWindow(range, 1330, true)).toBeNull();
  });

  it('is nothing when the passage is the whole recording', () => {
    expect(clipWindow({ start: 0, end: 43 }, 43, false)).toBeNull();
  });
});

describe('timelineView', () => {
  it('draws the passage with a margin to drag an edge into', () => {
    expect(timelineView({ start: 86.8, end: 400 }, 1330)).toEqual({
      start: 86.8 - VIEW_MARGIN_SEC,
      end: 400 + VIEW_MARGIN_SEC,
    });
  });

  it('stays inside the recording', () => {
    expect(timelineView({ start: 1, end: 1329 }, 1330)).toEqual({ start: 0, end: 1330 });
  });

  it('is nothing without a passage', () => {
    expect(timelineView(null, 1330)).toBeNull();
  });
});

describe('playing the clip', () => {
  const clip = { start: 86.8, end: 400 };

  it('starts at the first ayah from outside the passage', () => {
    expect(playFrom(11.8, clip)).toBe(86.8);
    expect(playFrom(400, clip)).toBe(86.8);
  });

  it('plays on from inside it', () => {
    expect(playFrom(120, clip)).toBeNull();
  });

  it('leaves an upload alone', () => {
    expect(playFrom(11.8, null)).toBeNull();
    expect(pastClipEnd(9999, null)).toBe(false);
  });

  it('stops at the last ayah', () => {
    expect(pastClipEnd(399.9, clip)).toBe(false);
    expect(pastClipEnd(400, clip)).toBe(true);
  });
});
