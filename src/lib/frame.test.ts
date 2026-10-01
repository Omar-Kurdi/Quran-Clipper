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
  it('marks the header, caption band and button column of each vertical feed', () => {
    for (const id of ['shorts', 'tiktok', 'reels', 'facebook']) {
      expect(coveredAreas(id).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('differs between feeds, as their apps do', () => {
    const [shorts, tiktok, reels] = ['shorts', 'tiktok', 'reels'].map(coveredAreas);
    // Reels has the tallest header, TikTok the deepest caption band.
    expect(reels[0].height).toBeGreaterThan(shorts[0].height);
    expect(tiktok[1].height).toBeGreaterThan(reels[1].height);
    expect(tiktok[1].height).toBeGreaterThan(shorts[1].height);
  });

  it('marks nothing where the feed leaves the video clear', () => {
    expect(coveredAreas('youtube')).toEqual([]);
    expect(coveredAreas('ig-feed')).toEqual([]);
    expect(coveredAreas('nonsense')).toEqual([]);
  });

  it('keeps every area inside the frame', () => {
    for (const area of ['shorts', 'tiktok', 'reels', 'facebook'].flatMap(coveredAreas)) {
      expect(area.left + area.width).toBeLessThanOrEqual(100);
      expect(area.top + area.height).toBeLessThanOrEqual(100);
    }
  });
});
