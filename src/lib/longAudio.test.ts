import { describe, it, expect } from 'vitest';
import {
  ENVELOPE_PER_SEC, ENVELOPE_SAMPLE_RATE, EnvelopeMeter, LONG_AUDIO_SEC, MAX_LONG_TRIM_SEC, envelopePeaks, isLongAudio, longCutWindow
} from './longAudio';

const PER_BUCKET = ENVELOPE_SAMPLE_RATE / ENVELOPE_PER_SEC;

describe('isLongAudio', () => {
  it('sends only a recording past the limit to the server', () => {
    expect(isLongAudio(LONG_AUDIO_SEC)).toBe(false);
    expect(isLongAudio(LONG_AUDIO_SEC + 1)).toBe(true);
    expect(isLongAudio(6772.8)).toBe(true);
  });

  it('keeps a recording whose length is unknown in the browser', () => {
    expect(isLongAudio(null)).toBe(false);
    expect(isLongAudio(undefined)).toBe(false);
    expect(isLongAudio(Infinity)).toBe(false);
  });
});

describe('longCutWindow', () => {
  it('keeps the cut inside the recording, ends in either order', () => {
    expect(longCutWindow(120, -5, 6772)).toEqual({ start: 0, end: 120 });
  });

  it('refuses a cut longer than one trim keeps', () => {
    expect(longCutWindow(0, MAX_LONG_TRIM_SEC + 60, 6772)).toBeNull();
    expect(longCutWindow(60, 60 + MAX_LONG_TRIM_SEC, 6772)).toEqual({ start: 60, end: 60 + MAX_LONG_TRIM_SEC });
  });

  it('is no cut for nothing', () => {
    expect(longCutWindow(30, 30, 6772)).toBeNull();
    expect(longCutWindow(NaN, 30, 6772)).toBeNull();
  });
});

describe('EnvelopeMeter', () => {
  it('keeps the loudest sample of every bucket, however the samples arrive', () => {
    const samples = new Float32Array(PER_BUCKET * 3);
    samples[5] = -0.5;
    samples[PER_BUCKET + 7] = 1;
    samples[PER_BUCKET * 2 + 1] = 0.2;
    const meter = new EnvelopeMeter();
    meter.push(samples.subarray(0, 100));
    meter.push(samples.subarray(100, PER_BUCKET + 3));
    meter.push(samples.subarray(PER_BUCKET + 3));
    const { envelope, duration } = meter.finish();
    expect(Array.from(envelope)).toEqual([128, 255, 51]);
    expect(duration).toBeCloseTo((PER_BUCKET * 3) / ENVELOPE_SAMPLE_RATE, 6);
  });

  it('closes a last bucket that is only part full', () => {
    const meter = new EnvelopeMeter();
    meter.push(new Float32Array([0, 0.4]));
    expect(Array.from(meter.finish().envelope)).toEqual([102]);
  });
});

describe('envelopePeaks', () => {
  it('draws each bar as the loudest of its stretch', () => {
    const envelope = Uint8Array.from([0, 255, 0, 0, 51, 0]);
    const peaks = Array.from(envelopePeaks(envelope, 3));
    expect(peaks.slice(0, 2)).toEqual([1, 0]);
    expect(peaks[2]).toBeCloseTo(0.2, 6);
  });

  it('reaches the last value when the bars do not divide it evenly', () => {
    const envelope = Uint8Array.from([0, 0, 0, 0, 255]);
    expect(envelopePeaks(envelope, 2)[1]).toBe(1);
  });

  it('draws nothing for no envelope', () => {
    expect(Array.from(envelopePeaks(new Uint8Array(0), 2))).toEqual([0, 0]);
  });
});
