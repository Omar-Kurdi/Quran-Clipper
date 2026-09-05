import { describe, it, expect } from 'vitest';
import { computePeaks } from './audioTrim';

/** Enough of an AudioBuffer for `computePeaks`; the real one needs a browser. */
const fakeBuffer = (data: number[]) =>
  ({
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => Float32Array.from(data),
  }) as unknown as AudioBuffer;

describe('computePeaks', () => {
  it('covers the whole buffer, including the tail', () => {
    // Rounding the bucket size down left up to one bucket's worth of samples
    // at the end uncovered, so a peak in the last moments of a clip could be
    // missed and every bucket was drawn slightly wider than the audio it held.
    const data = new Array(1000).fill(0);
    data[999] = 1;
    const peaks = computePeaks(fakeBuffer(data), 10);
    expect(peaks[peaks.length - 1]).toBe(1);
  });

  it('puts a peak in the bucket it actually falls in', () => {
    // The property the timeline depends on: where a sound is drawn is where it
    // happened.
    const data = new Array(1000).fill(0);
    data[500] = 1;
    const peaks = computePeaks(fakeBuffer(data), 10);
    expect(peaks[5]).toBe(1);
    expect(peaks.filter(p => p > 0)).toHaveLength(1);
  });

  it('reports a silent stretch as silent', () => {
    // A pause has to survive bucketing or the track cannot show one.
    const data = new Array(1000).fill(1);
    for (let i = 300; i < 400; i++) data[i] = 0;
    const peaks = computePeaks(fakeBuffer(data), 10);
    expect(peaks[3]).toBe(0);
  });

  it('takes the loudest sample in each bucket, not the first', () => {
    const data = new Array(100).fill(0);
    data[55] = 0.8;
    const peaks = computePeaks(fakeBuffer(data), 10);
    expect(peaks[5]).toBeCloseTo(0.8);
  });

  it('handles more buckets than samples without dividing by zero', () => {
    const peaks = computePeaks(fakeBuffer([0, 1, 0]), 10);
    expect(peaks).toHaveLength(10);
    expect(Math.max(...peaks)).toBe(1);
  });
});
