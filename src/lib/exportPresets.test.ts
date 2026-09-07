import { describe, it, expect } from 'vitest';
import {
  EXPORT_PRESETS, presetById, presetForAspect, dimensionsFor, bitrateFor,
  planExport, formatBytes, formatBitrate,
  MAX_EXPORT_BYTES, MAX_EXPORT_HEAP_BYTES, EXPORT_MEMORY_FACTOR,
  previewPlan, PREVIEW_LONG_SIDE
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

  it('steps down a tier rather than spending more memory than it has', () => {
    // Eighty seconds at 4K60 is ~400 MB of file and four times that to build.
    const plan = planExport({ presetId: 'tiktok', tier: 'max', fps: 60, seconds: 80 });
    expect(plan.steppedDownFrom).toBe('max');
    expect(plan.tier).not.toBe('max');
    expect(plan.estimatedBytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
  });

  it('gives up bitrate only once there is no tier left to give up', () => {
    // Five minutes at 1080p60 is over the ceiling at full bitrate, and fits
    // once it is spent down.
    const plan = planExport({ presetId: 'tiktok', tier: 'standard', fps: 60, seconds: 5 * 60 });
    expect(plan.tier).toBe('standard');
    expect(plan.bitrateReduced).toBe(true);
    expect(plan.exceedsMemory).toBe(false);
    expect(plan.estimatedBytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
  });

  it('budgets the memory a render spends, not the file it produces', () => {
    expect(MAX_EXPORT_BYTES).toBe(Math.round(MAX_EXPORT_HEAP_BYTES / EXPORT_MEMORY_FACTOR));

    // The render that killed a tab: a ninety-second recitation asked for at 4K.
    // The old ceiling compared the finished file against a budget four times
    // too generous, so this planned at full 4K and reached about 1.8 GB.
    const plan = planExport({ presetId: 'tiktok', tier: 'max', fps: 60, seconds: 90 });
    expect(plan.steppedDownFrom).toBe('max');
    expect(plan.width).toBeLessThan(2160);
    expect(plan.estimatedBytes * EXPORT_MEMORY_FACTOR).toBeLessThanOrEqual(MAX_EXPORT_HEAP_BYTES);
  });

  it('admits when a clip will not fit however it is planned', () => {
    // Four hours does not fit at any bitrate worth rendering, and rendering it
    // at one that would is not an answer either.
    const plan = planExport({ presetId: 'tiktok', tier: 'max', fps: 60, seconds: 4 * 60 * 60 });
    expect(plan.bitrateReduced).toBe(true);
    expect(plan.exceedsMemory).toBe(true);
  });

  it('previews at a fraction of the pixels, keeping the frame shape', () => {
    const plan = planExport({ presetId: 'shorts', tier: 'max', fps: 60, seconds: 30 });
    const preview = previewPlan(plan);
    expect(Math.max(preview.width, preview.height)).toBe(PREVIEW_LONG_SIDE);
    // 9:16 stays 9:16 -- a preview of a different shape would answer a
    // question about a video nobody is making.
    expect(preview.width / preview.height).toBeCloseTo(plan.width / plan.height, 2);
    expect(preview.width % 2).toBe(0);
    expect(preview.height % 2).toBe(0);
    expect(preview.width * preview.height).toBeLessThan(plan.width * plan.height / 4);
    // The render's own rate, not a reduced one: measured, 24fps previews took
    // longer than 60fps ones, and a different rate would also misrepresent the
    // timing the preview exists to show.
    expect(preview.fps).toBe(plan.fps);
  });

  it('shrinks a landscape frame too, not only a portrait one', () => {
    const plan = planExport({ presetId: 'youtube', tier: 'max', fps: 60, seconds: 30 });
    const preview = previewPlan(plan);
    expect(plan.width).toBeGreaterThan(plan.height);
    expect(preview.width).toBeLessThan(plan.width);
    expect(preview.width / preview.height).toBeCloseTo(plan.width / plan.height, 2);
  });

  it('never previews larger than the render it stands in for, in either direction', () => {
    const small = planExport({ presetId: 'ig-feed', tier: 'standard', fps: 30, seconds: 10 });
    // A frame already smaller than the cap must come back untouched rather
    // than scaled up to meet it.
    const preview = previewPlan({ ...small, width: 320, height: 320, fps: 30 });
    expect(preview.width).toBeLessThanOrEqual(320);
    expect(preview.height).toBeLessThanOrEqual(320);
    // And a wide, short frame must not keep its full width.
    const wide = previewPlan({ ...small, width: 1920, height: 360, fps: 30 });
    expect(wide.width).toBeLessThanOrEqual(1920);
    expect(wide.width).toBe(PREVIEW_LONG_SIDE);
    expect(preview.fps).toBe(30);
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
