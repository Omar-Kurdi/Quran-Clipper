import { describe, it, expect } from 'vitest';
import { exportRangeFor } from './exportRange';

// The Ash-Shura 42:15 upload: trimmed to 62.20s, first caption at 0.32s.
const trimmed = [
  { startTime: 0.319, endTime: 12.28 },
  { startTime: 12.28, endTime: 62.0 },
];

describe('exportRangeFor', () => {
  it('exports an upload whole, as the trimmer cut it and the preview plays it', () => {
    expect(exportRangeFor(trimmed, 62.2, true)).toEqual({ start: 0, end: 62.2, span: 62.2 });
  });

  it('exports a reciter passage from its first ayah to its last, not the chapter', () => {
    const passage = [
      { startTime: 4410.5, endTime: 4432.0 },
      { startTime: 4432.0, endTime: 4461.25 },
    ];
    expect(exportRangeFor(passage, 5230, false)).toEqual({ start: 4410.5, end: 4461.25, span: 50.75 });
  });

  it('keeps a reciter passage inside the audio it has', () => {
    expect(exportRangeFor([{ startTime: -0.2, endTime: 31 }], 30, false)).toEqual({ start: 0, end: 30, span: 30 });
  });

  it('falls back to the whole file when there is no timeline to read', () => {
    expect(exportRangeFor([], 40, false)).toEqual({ start: 0, end: 40, span: 40 });
    expect(exportRangeFor([{ startTime: 5, endTime: 5 }], 40, false)).toEqual({ start: 0, end: 40, span: 40 });
  });
});
