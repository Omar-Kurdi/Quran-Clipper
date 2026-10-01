import { describe, it, expect } from 'vitest';
import { EXPORT_PRESETS } from './exportPresets';
import { framePreset, coveredAreas } from './frame';

const indexOf = (id: string) => EXPORT_PRESETS.findIndex(p => p.id === id);

describe('framePreset', () => {
  it('keeps the platform chosen while the studio is still in its shape', () => {
    // Reels and Shorts are both 9:16; the shape alone would answer Shorts.
    expect(framePreset(indexOf('reels'), '9:16').id).toBe('reels');
  });

  it('answers for the shape a project was opened in, not a stale choice', () => {
    expect(framePreset(indexOf('reels'), '1:1').id).toBe('ig-feed');
    expect(framePreset(indexOf('reels'), '16:9').id).toBe('youtube');
  });

  it('survives an index that no longer names a platform', () => {
    expect(framePreset(99, '4:5').id).toBe('ig-portrait');
  });
});

describe('coveredAreas', () => {
  it('marks the header, caption band and button column of a vertical feed', () => {
    for (const id of ['shorts', 'tiktok', 'reels', 'facebook']) {
      expect(coveredAreas(id)).toHaveLength(3);
    }
  });

  it('marks nothing where the feed leaves the video clear', () => {
    expect(coveredAreas('youtube')).toEqual([]);
    expect(coveredAreas('ig-feed')).toEqual([]);
    expect(coveredAreas('nonsense')).toEqual([]);
  });

  it('keeps every area inside the frame', () => {
    for (const area of coveredAreas('shorts')) {
      expect(area.left + area.width).toBeLessThanOrEqual(100);
      expect(area.top + area.height).toBeLessThanOrEqual(100);
    }
  });
});
