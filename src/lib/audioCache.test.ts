import { describe, it, expect } from 'vitest';
import { byteRange } from './audioCache';

describe('byteRange', () => {
  it('reads the ranges ffmpeg and the player ask for', () => {
    expect(byteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(byteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('serves the whole file without a range, and refuses one past the end', () => {
    expect(byteRange(null, 1000)).toBeNull();
    expect(byteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
  });
});
