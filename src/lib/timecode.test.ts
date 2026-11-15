import { describe, it, expect } from 'vitest';
import { formatDuration, formatTick, parseTimecode } from './timecode';

describe('formatDuration', () => {
  it('reads m:ss.s under an hour', () => {
    expect(formatDuration(0)).toBe('0:00.0');
    expect(formatDuration(211.74)).toBe('3:31.7');
    expect(formatDuration(3599.9)).toBe('59:59.9');
  });

  it('reads h:mm:ss.s from an hour on, not as minutes past sixty', () => {
    // An hour into Al-Baqarah read "68:00.0", and the trim fields gave no
    // hint that "1:08:00" was what to type.
    expect(formatDuration(68 * 60)).toBe('1:08:00.0');
    expect(formatDuration(70 * 60 + 5.25)).toBe('1:10:05.3');
    expect(formatDuration(6773)).toBe('1:52:53.0');
  });

  it('rounds the tenths before splitting, so a minute never reads as sixty seconds', () => {
    expect(formatDuration(59.96)).toBe('1:00.0');
    expect(formatDuration(3599.96)).toBe('1:00:00.0');
  });

  it('reads back as the time it was made from', () => {
    for (const seconds of [0, 59.9, 211.7, 3600, 4080.4, 6773]) {
      expect(parseTimecode(formatDuration(seconds))).toBeCloseTo(seconds, 5);
    }
  });
});

describe('formatTick', () => {
  it('drops the decimal for ticks a second or more apart, hours included', () => {
    expect(formatTick(90, 30)).toBe('1:30');
    expect(formatTick(4080, 60)).toBe('1:08:00');
  });

  it('keeps tenths for ticks under a second apart', () => {
    expect(formatTick(4080.5, 0.5)).toBe('1:08:00.5');
  });
});

describe('parseTimecode', () => {
  it('takes minutes, hours or bare seconds', () => {
    expect(parseTimecode('3:31.7')).toBeCloseTo(211.7, 5);
    expect(parseTimecode('1:08:00')).toBe(4080);
    expect(parseTimecode('68:00')).toBe(4080);
    expect(parseTimecode('211.7')).toBeCloseTo(211.7, 5);
  });

  it('refuses what it cannot read', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('3:')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
  });
});
