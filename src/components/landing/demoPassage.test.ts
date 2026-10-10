import { describe, expect, it } from 'vitest';
import { DEMO_CAPTIONS, DEMO_WAVEFORM, captionAt } from './demoPassage';

describe('captionAt', () => {
  it('shows the ayah being recited, and lights the words already begun', () => {
    expect(captionAt(0)).toMatchObject({ caption: { verseKey: '67:1' }, spoken: 1 });
    expect(captionAt(3)).toMatchObject({ caption: { verseKey: '67:1' }, spoken: 4 });
    // 67:2 begins at 8.12s with ٱلَّذِى; خَلَقَ follows at 9.04s.
    expect(captionAt(8.93)).toMatchObject({ caption: { verseKey: '67:2' }, spoken: 1 });
  });

  it('holds the last caption after the recitation ends', () => {
    expect(captionAt(20)).toMatchObject({ caption: { verseKey: '67:2' }, spoken: 11 });
  });

  it('keeps each caption’s words in order within its bounds', () => {
    for (const c of DEMO_CAPTIONS) {
      const times = c.words.map(w => w.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(c.start);
      expect(times[times.length - 1]).toBeLessThan(c.end);
    }
    expect(DEMO_WAVEFORM).toHaveLength(120);
  });
});
