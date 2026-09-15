import { describe, it, expect } from 'vitest';
import { timelineDuration } from './route';

describe('timelineDuration', () => {
  it('puts a windowed alignment on the recording clock, not the window one', () => {
    // Reported against Yunus 10:26-27: the sidecar was asked for 456.7-550.5s
    // of the surah, decoded 93.9s, and returned segments starting at 456.7s.
    // Clamping those to 93.9 dropped every one and emptied the timeline.
    expect(timelineDuration({ provider: 'local', reported: 93.86, windowStart: 456.7, client: 0 }))
      .toBeCloseTo(550.56, 2);
  });

  it('takes the sidecar measurement whole when there was no window', () => {
    expect(timelineDuration({ provider: 'local', reported: 68.5, windowStart: 0, client: 120 })).toBe(68.5);
  });

  it('prefers the browser decode for Gemini, which only estimates', () => {
    // Measured: Gemini reported 108s for a 68.5s file and stretched its times
    // to match, so its own figure runs the timeline past the end of the audio.
    expect(timelineDuration({ provider: 'gemini', reported: 108, windowStart: 0, client: 68.5 })).toBe(68.5);
  });

  it('falls back to Gemini\'s figure when the browser sent none', () => {
    expect(timelineDuration({ provider: 'gemini', reported: 108, windowStart: 0, client: 0 })).toBe(108);
  });

  it('falls back to the browser when the sidecar reported nothing', () => {
    expect(timelineDuration({ provider: 'local', reported: 0, windowStart: 0, client: 68.5 })).toBe(68.5);
    expect(timelineDuration({ provider: 'local', reported: 0, windowStart: 0, client: 0 })).toBe(0);
  });
});
