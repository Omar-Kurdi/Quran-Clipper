import { describe, it, expect } from 'vitest';
import {
  EXPORT_PRESETS, presetById, presetForAspect, dimensionsFor, bitrateFor,
  planExport, formatBytes, formatBitrate, MAX_EXPORT_BYTES
} from './exportPresets';

describe('export presets', () => {
  it('names a preset for every frame shape the studio offers', () => {
    for (const ratio of ['9:16', '16:9', '1:1', '4:5']) {
      expect(presetForAspect(ratio).aspectRatio).toBe(ratio);
    }
  });

  it('falls back rather than returning nothing for an unknown id', () => {
    expect(presetById('not-a-platform')).toBe(EXPORT_PRESETS[0]);
  });

  it('keeps the frame in the ratio it claims, at every tier', () => {
    for (const tier of ['standard', 'high', 'max'] as const) {
      const vertical = dimensionsFor('9:16', tier);
      expect(vertical.width / vertical.height).toBeCloseTo(9 / 16, 2);
      const wide = dimensionsFor('16:9', tier);
      expect(wide.width / wide.height).toBeCloseTo(16 / 9, 2);
      // H.264 refuses odd dimensions.
      expect(vertical.width % 2).toBe(0);
      expect(vertical.height % 2).toBe(0);
    }
  });

  it('gives every tier more pixels than the one below it', () => {
    const standard = dimensionsFor('9:16', 'standard');
    const high = dimensionsFor('9:16', 'high');
    const max = dimensionsFor('9:16', 'max');
    expect(high.height).toBeGreaterThan(standard.height);
    expect(max.height).toBeGreaterThan(high.height);
    expect(standard).toEqual({ width: 1080, height: 1920 });
    expect(max).toEqual({ width: 2160, height: 3840 });
  });

  it('spends more on a bigger frame and on a faster one', () => {
    const at30 = bitrateFor(1080, 1920, 30, 'standard');
    const at60 = bitrateFor(1080, 1920, 60, 'standard');
    expect(at60).toBeGreaterThan(at30);
    expect(bitrateFor(2160, 3840, 30, 'max')).toBeGreaterThan(at30);
  });

  it('plans a short clip at exactly what was asked for', () => {
    const plan = planExport({ presetId: 'reels', tier: 'max', fps: 30, seconds: 45 });
    expect(plan.tier).toBe('max');
    expect(plan.steppedDownFrom).toBeUndefined();
    expect(plan.bitrateReduced).toBe(false);
    expect(plan.width).toBe(2160);
    expect(plan.estimatedBytes).toBeLessThan(MAX_EXPORT_BYTES);
  });

  it('steps down a tier rather than exceeding what one buffer can hold', () => {
    // Forty minutes of recitation at 4K would be several gigabytes in memory.
    const plan = planExport({ presetId: 'tiktok', tier: 'max', fps: 60, seconds: 40 * 60 });
    expect(plan.steppedDownFrom).toBe('max');
    expect(plan.tier).not.toBe('max');
    expect(plan.estimatedBytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
  });

  it('gives up bitrate only once there is no tier left to give up', () => {
    // Twenty minutes at 1080p60 is over the ceiling at full bitrate, and fits
    // once it is spent down.
    const plan = planExport({ presetId: 'tiktok', tier: 'standard', fps: 60, seconds: 20 * 60 });
    expect(plan.tier).toBe('standard');
    expect(plan.bitrateReduced).toBe(true);
    expect(plan.exceedsMemory).toBe(false);
    expect(plan.estimatedBytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
  });

  it('admits when a clip will not fit however it is planned', () => {
    // Four hours does not fit at any bitrate worth rendering, and rendering it
    // at one that would is not an answer either.
    const plan = planExport({ presetId: 'tiktok', tier: 'max', fps: 60, seconds: 4 * 60 * 60 });
    expect(plan.bitrateReduced).toBe(true);
    expect(plan.exceedsMemory).toBe(true);
  });

  it('says how far over a platform limit a clip runs', () => {
    // Reels stops at 90 seconds.
    expect(planExport({ presetId: 'reels', tier: 'standard', fps: 30, seconds: 120 }).overLongBy).toBe(30);
    expect(planExport({ presetId: 'reels', tier: 'standard', fps: 30, seconds: 60 }).overLongBy).toBeUndefined();
    // YouTube has no limit worth warning about.
    expect(planExport({ presetId: 'youtube', tier: 'standard', fps: 60, seconds: 3600 }).overLongBy).toBeUndefined();
  });

  it('reads its numbers back the way they are quoted', () => {
    expect(formatBitrate(12_000_000)).toBe('12 Mbps');
    expect(formatBytes(220_000_000)).toBe('220 MB');
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
  });
});
