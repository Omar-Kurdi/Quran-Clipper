import { describe, it, expect } from 'vitest';
import { exportFileName } from './exportName';

describe('exportFileName', () => {
  it('names a clip by the surah and the range on the timeline', () => {
    expect(exportFileName('At-Tahrim', 66, 6, 8)).toBe('At-Tahrim_66_6-8.webm');
  });

  it('is stable, so re-exporting a passage gives the same name', () => {
    expect(exportFileName('Al-Fatihah', 1, 1, 7)).toBe(exportFileName('Al-Fatihah', 1, 1, 7));
  });

  it('strips characters a filesystem would reject, the colon included', () => {
    // The colon is legal on Linux and macOS but not Windows, and a name that
    // survives everywhere is worth more than one that reads like a reference.
    expect(exportFileName('Bad/Name:*?"<>|', 36, 1, 83)).toBe('BadName_36_1-83.webm');
  });

  it('joins a multi-word surah name with underscores', () => {
    expect(exportFileName('Ali Imran', 3, 1, 5)).toBe('Ali_Imran_3_1-5.webm');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(exportFileName('   ', 2, 1, 5)).toBe('QuranClip_2_1-5.webm');
  });

  it('says webm, which is what the recorder actually produces', () => {
    expect(exportFileName('Al-Mulk', 67, 1, 5).endsWith('.webm')).toBe(true);
  });
});

describe('container extension', () => {
  it('defaults to webm, which the real-time recorder produces', () => {
    expect(exportFileName('At-Tahrim', 66, 6, 8)).toMatch(/\.webm$/);
  });

  it('names an mp4 when that is what was encoded', () => {
    // The frame-by-frame path writes MP4. A file called .webm that is really
    // MP4 is worse than either name on its own.
    expect(exportFileName('At-Tahrim', 66, 6, 8, 'mp4')).toBe('At-Tahrim_66_6-8.mp4');
  });
});
