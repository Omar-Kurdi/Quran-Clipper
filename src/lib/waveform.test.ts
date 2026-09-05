import { describe, it, expect } from 'vitest';
import { bucketsFor } from './waveform';

describe('bucketsFor', () => {
  it('keeps resolution constant as the clip gets longer', () => {
    // The bug: a fixed bucket count meant every extra minute made the track
    // coarser. 68s got 76ms buckets and 250s got 277ms ones, while the pauses
    // being shown are 0.2-0.5s long.
    const msPerBucket = (seconds: number) => (seconds * 1000) / bucketsFor(seconds);
    expect(msPerBucket(60)).toBeCloseTo(msPerBucket(600), 5);
  });

  it('resolves the shortest pause the aligner will act on', () => {
    // ALIGN_MIN_UNMARKED_PAUSE_SEC is 0.30s. It has to be several buckets wide
    // or it lands in whichever one it happens to straddle.
    for (const seconds of [60, 250, 600]) {
      const bucketSec = seconds / bucketsFor(seconds);
      expect(0.3 / bucketSec).toBeGreaterThan(10);
    }
  });

  it('still draws a real shape for a very short clip', () => {
    expect(bucketsFor(2)).toBe(900);
  });

  it('stops growing before the array becomes a problem', () => {
    expect(bucketsFor(100_000)).toBe(120_000);
  });

  it('falls back rather than returning nonsense for an unknown duration', () => {
    expect(bucketsFor(0)).toBe(900);
    expect(bucketsFor(NaN)).toBe(900);
    expect(bucketsFor(-5)).toBe(900);
  });
});
