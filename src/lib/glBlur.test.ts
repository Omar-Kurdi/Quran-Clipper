import { describe, it, expect } from 'vitest';
import { MAX_TAPS, blurScale, gaussianWeights } from './glBlur';

describe('gaussianWeights', () => {
  it('sums to one across both sides, so a blur neither brightens nor darkens', () => {
    for (const sigma of [0.8, 2, 5, 8]) {
      const weights = gaussianWeights(sigma);
      const total = weights[0] + 2 * weights.slice(1).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('falls off from the centre', () => {
    const weights = gaussianWeights(4);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThan(weights[i - 1]);
  });

  it('never asks the shader for more samples than its loop allows', () => {
    expect(gaussianWeights(100).length - 1).toBeLessThanOrEqual(MAX_TAPS);
  });
});

describe('blurScale', () => {
  it('blurs small radii at full size', () => {
    expect(blurScale(5)).toBe(1);
    expect(blurScale(MAX_TAPS / 3)).toBe(1);
  });

  it('shrinks large ones until three standard deviations fit the kernel', () => {
    // The Minimal preset's blur: 6 on the slider, 15 px of standard deviation.
    for (const sigma of [15, 37.5, 62.5]) {
      const scale = blurScale(sigma);
      expect((sigma / scale) * 3).toBeLessThanOrEqual(MAX_TAPS);
      expect(scale).toBeGreaterThan(1);
    }
  });
});
