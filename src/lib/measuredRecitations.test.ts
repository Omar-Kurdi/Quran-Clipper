import { describe, it, expect } from 'vitest';
import { measuredBounds, measuredPassage, measuredRegions, measuredSurah } from './measuredRecitations';

describe('measuredRecitations', () => {
  it("holds Khalid al-Jalil's 104, with his going back over 104:2-3 as captions of their own", () => {
    const held = measuredSurah('jalil', 104)!;
    expect(held.segments.map(s => s.verseKey)).toEqual(['104:1', '104:2', '104:3', '104:2', '104:3', '104:4', '104:5', '104:6', '104:7', '104:8', '104:9']);
    expect(held.segments.find(s => s.notes === 'restarted phrase')?.verseKey).toBe('104:2');
  });

  it("holds 103:1, which the aligner's reading missed", () => {
    expect(measuredSurah('jalil', 103)!.segments.map(s => s.verseKey)).toEqual(['103:1', '103:2', '103:3']);
  });

  it('answers only for its own recording, and gives a passage its own ayahs', () => {
    const url = measuredSurah('jalil', 104)!.audioUrl;
    expect(measuredPassage('jalil', 104, 4, 5, 'https://example.com/other.mp3')).toBeNull();
    const passage = measuredPassage('jalil', 104, 4, 5, `/api/audio/proxy?url=${encodeURIComponent(url)}`)!;
    expect(passage.segments.map(s => s.verseKey)).toEqual(['104:4', '104:5']);
    expect(measuredSurah('sudais', 1)).toBeNull();
  });

  it('bounds each ayah of a load from its first caption to the next ayah', () => {
    const bounds = measuredBounds(measuredSurah('jalil', 104)!, ['104:2', '104:3', '104:4']);
    expect(bounds.get('104:2')!.end).toBe(bounds.get('104:3')!.start);
    expect(bounds.get('104:3')!.end).toBe(bounds.get('104:4')!.start);
  });
});

describe('measuredRegions', () => {
  const audio = 'https://download.quranicaudio.com/qdc/khalid_jalil/murattal/mp3/82.mp3';

  it("holds Khalid al-Jalil's 82:17-19, read twice over, in the order recited", () => {
    const [region] = measuredRegions('jalil', 82, 16, 20, audio);
    expect(region.ayahs).toEqual([17, 19]);
    expect(region.segments.map(s => s.verseKey).filter((key, i, all) => key !== all[i - 1]))
      .toEqual(['82:17', '82:18', '82:19', '82:17', '82:18', '82:19']);
  });

  it('only for the passages that touch it, on the recording it was measured on, through the proxy too', () => {
    expect(measuredRegions('jalil', 82, 1, 16, audio)).toEqual([]);
    expect(measuredRegions('jalil', 82, 19, 19, `/api/audio/proxy?url=${encodeURIComponent(audio)}`)).toHaveLength(1);
    expect(measuredRegions('jalil', 82, 17, 19, 'https://download.quranicaudio.com/qdc/other/82.mp3')).toEqual([]);
    expect(measuredRegions('muaiqly', 82, 17, 19, audio)).toEqual([]);
  });
});
