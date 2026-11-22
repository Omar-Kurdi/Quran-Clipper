import { describe, expect, it } from 'vitest';
import { fittingZoom } from './timelineZoom';

const ZOOMS = [1, 2, 4, 8];
const LONG_ZOOMS = [1, 2, 4, 8, 16, 32, 64];

describe('fittingZoom', () => {
  it('opens a short clip whose captions fit already without zoom', () => {
    // Yusuf 12:1-3: six captions over 41.7 s on a 1590 px track.
    expect(fittingZoom([3.8, 5.3, 4.6, 9.8, 11.2, 6.8], 41.7, 1590, ZOOMS)).toBe(1);
  });

  it('zooms a whole surah only as far as its captions need', () => {
    const lengths = Array.from({ length: 255 }, (_, i) => 4 + (i % 10));
    expect(fittingZoom(lengths, 2090.9, 1590, LONG_ZOOMS)).toBe(16);
  });

  it('lets the shortest tenth stay narrow', () => {
    const lengths = [0.4, ...Array.from({ length: 19 }, () => 10)];
    expect(fittingZoom(lengths, 200, 1000, ZOOMS)).toBe(1);
  });

  it('takes the greatest zoom when none is enough, and none with no captions', () => {
    expect(fittingZoom([0.5, 0.5], 3600, 800, ZOOMS)).toBe(8);
    expect(fittingZoom([], 100, 800, ZOOMS)).toBeNull();
  });
});
