import { describe, it, expect } from 'vitest';
import { spectrumAt, SPECTRUM_BINS } from './spectrum';

const tone = (hz: number, seconds: number, sampleRate = 48000) => {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
};

describe('spectrumAt', () => {
  const rate = 48000;
  const out = () => new Uint8Array(SPECTRUM_BINS);

  it('puts a pure tone in the bin it belongs to', () => {
    // The property the bars depend on: a low note moves the low bars. An
    // amplitude-only fake would move all of them together.
    const bins = spectrumAt(tone(1000, 1), rate, 0.5, out());
    const loudest = bins.indexOf(Math.max(...bins));
    const expected = Math.round((1000 / rate) * 512);
    expect(Math.abs(loudest - expected)).toBeLessThanOrEqual(2);
  });

  it('separates a low tone from a high one', () => {
    const low = spectrumAt(tone(300, 1), rate, 0.5, out());
    const high = spectrumAt(tone(6000, 1), rate, 0.5, out());
    expect(low.indexOf(Math.max(...low))).toBeLessThan(high.indexOf(Math.max(...high)));
  });

  it('reports silence as silence', () => {
    const bins = spectrumAt(new Float32Array(48000), rate, 0.5, out());
    expect(Math.max(...bins)).toBe(0);
  });

  it('reads zero outside the audio rather than sampling wildly', () => {
    // Frames at the very start and end look past the ends of the buffer.
    const samples = tone(1000, 0.1);
    expect(() => spectrumAt(samples, rate, -1, out())).not.toThrow();
    expect(() => spectrumAt(samples, rate, 99, out())).not.toThrow();
    expect(Math.max(...spectrumAt(samples, rate, 99, out()))).toBe(0);
  });

  it('gives the analyser byte range, so it can share the drawing code', () => {
    const bins = spectrumAt(tone(1000, 1), rate, 0.5, out());
    expect(bins.length).toBe(SPECTRUM_BINS);
    expect(Math.max(...bins)).toBeLessThanOrEqual(255);
    expect(Math.min(...bins)).toBeGreaterThanOrEqual(0);
  });

  it('is louder for a louder signal', () => {
    // Both compared below the ceiling. The mapping saturates at -30 dB exactly
    // as an AnalyserNode does with its default maxDecibels, so two signals
    // that are both loud read the same on purpose -- matching the preview
    // matters more than distinguishing them.
    const at = (gain: number) => {
      const scaled = Float32Array.from(tone(1000, 1), v => v * gain);
      return Math.max(...spectrumAt(scaled, rate, 0.5, out()));
    };
    expect(at(0.01)).toBeGreaterThan(at(0.001));
  });

  it('saturates where an AnalyserNode would, rather than running past it', () => {
    const full = Math.max(...spectrumAt(tone(1000, 1), rate, 0.5, out()));
    expect(full).toBe(255);
  });
});
