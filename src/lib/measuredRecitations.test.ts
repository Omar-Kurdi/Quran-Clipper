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

  it("holds Khalid al-Jalil's 68:29-31, with 68:29 said three times and 68:30 twice before 68:31", () => {
    // 68:31 used to start inside his third 68:29: both open with قَالُوا۟ (reported 2026-10-10).
    const [region] = measuredRegions('jalil', 68, 31, 31, 'https://download.quranicaudio.com/qdc/khalid_jalil/murattal/mp3/68.mp3');
    expect(region.segments.map(s => s.verseKey)).toEqual(['68:29', '68:30', '68:29', '68:29', '68:30', '68:31']);
    expect(region.segments[5].startTime).toBeGreaterThan(158.5);
  });

  it("holds Khalid al-Jalil's 101:6-7, said twice, by ear: the aligner reads the repeat as 101:8", () => {
    const [region] = measuredRegions('jalil', 101, 6, 9, 'https://download.quranicaudio.com/qdc/khalid_jalil/murattal/mp3/101.mp3');
    expect(region.segments.map(s => s.verseKey)).toEqual(['101:6', '101:7', '101:6', '101:7']);
    expect(region.segments[3].endTime).toBeLessThanOrEqual(37.3);
  });

  it("holds Yasser al-Dosari's 69:28 said twice before 69:29, on quran.com's own recording", () => {
    // quran.com starts 69:29 at 258.2s, in the pause before his repeat of 69:28 (found 2026-10-11).
    const [region] = measuredRegions('yasser', 69, 29, 29, 'https://download.quranicaudio.com/quran/yasser_ad-dussary//069.mp3');
    expect(region?.segments.map(s => [s.verseKey, s.startTime])).toEqual([['69:28', 250.5], ['69:28', 260.2], ['69:29', 264.4]]);
  });

  it('only for the passages that touch it, on the recording it was measured on, through the proxy too', () => {
    expect(measuredRegions('jalil', 82, 1, 16, audio)).toEqual([]);
    expect(measuredRegions('jalil', 82, 19, 19, `/api/audio/proxy?url=${encodeURIComponent(audio)}`)).toHaveLength(1);
    expect(measuredRegions('jalil', 82, 17, 19, 'https://download.quranicaudio.com/qdc/other/82.mp3')).toEqual([]);
    expect(measuredRegions('muaiqly', 82, 17, 19, audio)).toEqual([]);
  });
});
