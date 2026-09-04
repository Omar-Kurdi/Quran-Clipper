import { describe, it, expect } from 'vitest';
import {
  backgroundPlaylist,
  backgroundAt,
  backgroundLabel,
  mediaKind,
  rememberMediaKind,
  appendSegment,
  removeSegment,
  resizeSegment,
  moveSegmentTo,
} from './backgroundTimeline';

describe('backgroundPlaylist', () => {
  it('includes stills, not only video', () => {
    // The bug this pins: the gate was `bgType !== 'video'`, so choosing an
    // image emptied the playlist, the canvas had nothing to draw, and it fell
    // through to the gradient -- an upload that appeared to do nothing at all.
    expect(backgroundPlaylist({ bgType: 'image', bgUrl: 'dunes.png' })).toEqual(['dunes.png']);
  });

  it('is empty only for the two types that genuinely have no media', () => {
    expect(backgroundPlaylist({ bgType: 'gradient', bgUrl: 'x.mp4' })).toEqual([]);
    expect(backgroundPlaylist({ bgType: 'color', bgUrl: 'x.mp4' })).toEqual([]);
  });

  it('keeps a repeated clip twice, because the list is a sequence', () => {
    const list = backgroundPlaylist({
      bgType: 'video', bgUrl: '', bgMode: 'cycle', bgUrls: ['a.mp4', 'b.mp4', 'a.mp4'],
    });
    expect(list).toEqual(['a.mp4', 'b.mp4', 'a.mp4']);
  });

  it('falls back to the single url when a multi mode has an empty list', () => {
    expect(backgroundPlaylist({ bgType: 'video', bgUrl: 'a.mp4', bgMode: 'cycle', bgUrls: [] }))
      .toEqual(['a.mp4']);
  });

  it('deduplicates in custom mode, where the lane carries the order', () => {
    const list = backgroundPlaylist({
      bgType: 'video', bgUrl: '', bgMode: 'custom',
      bgSegments: [
        { url: 'a.mp4', start: 0, end: 5 },
        { url: 'b.mp4', start: 5, end: 9 },
        { url: 'a.mp4', start: 9, end: 12 },
      ],
    });
    expect(list.sort()).toEqual(['a.mp4', 'b.mp4']);
  });
});

describe('backgroundAt', () => {
  const starts = [0, 10, 20];

  it('holds one background for the whole clip in single mode', () => {
    const at = backgroundAt({ bgType: 'video', bgUrl: 'a.mp4' }, starts, 15);
    expect(at?.url).toBe('a.mp4');
  });

  it('changes with the ayah in per-ayah mode', () => {
    const config = { bgType: 'video', bgUrl: '', bgMode: 'per-ayah' as const, bgUrls: ['a.mp4', 'b.mp4'] };
    expect(backgroundAt(config, starts, 5)?.url).toBe('a.mp4');
    expect(backgroundAt(config, starts, 15)?.url).toBe('b.mp4');
  });

  it('reports where the clip came on screen, so it can play from its own start', () => {
    const config = { bgType: 'video', bgUrl: '', bgMode: 'per-ayah' as const, bgUrls: ['a.mp4', 'b.mp4'] };
    expect(backgroundAt(config, starts, 15)?.start).toBe(10);
  });

  it('gives the same answer twice for the same time in shuffle mode', () => {
    // Seeded, not random: the preview and the export have to agree, and a
    // frame-by-frame reshuffle would flicker.
    const config = { bgType: 'video', bgUrl: '', bgMode: 'shuffle' as const, bgUrls: ['a.mp4', 'b.mp4', 'c.mp4'] };
    expect(backgroundAt(config, starts, 15)?.url).toBe(backgroundAt(config, starts, 15)?.url);
  });

  it('treats a time inside no custom segment as genuinely no background', () => {
    const config = {
      bgType: 'video', bgUrl: '', bgMode: 'custom' as const,
      bgSegments: [{ url: 'a.mp4', start: 0, end: 5 }],
    };
    expect(backgroundAt(config, starts, 8)).toBeNull();
  });
});

describe('mediaKind', () => {
  it('reads a still from its extension', () => {
    expect(mediaKind('photo.PNG')).toBe('image');
    expect(mediaKind('clip.mp4')).toBe('video');
  });

  it('ignores a query string when reading the extension', () => {
    expect(mediaKind('photo.jpg?width=800')).toBe('image');
  });

  it('remembers what an extensionless url turned out to be', () => {
    // A blob: url carries no extension, so guessing from the string alone
    // would call every upload a video.
    rememberMediaKind('blob:abc123', 'image');
    expect(mediaKind('blob:abc123')).toBe('image');
  });
});

describe('backgroundLabel', () => {
  it('never shows a base64 payload as a name', () => {
    const label = backgroundLabel('data:image/png;base64,' + 'A'.repeat(500));
    expect(label.length).toBeLessThan(60);
  });

  it('does not show a blob id as a name either', () => {
    expect(backgroundLabel('blob:http://localhost:3000/9f8e-1234')).not.toContain('9f8e');
  });
});

describe('custom lane edits', () => {
  const lane = [
    { url: 'a.mp4', start: 0, end: 5 },
    { url: 'b.mp4', start: 5, end: 10 },
  ];

  it('appends after the last segment', () => {
    const next = appendSegment(lane, 'c.mp4', 12);
    expect(next).toHaveLength(3);
    expect(next[2].url).toBe('c.mp4');
    expect(next[2].start).toBeGreaterThanOrEqual(10);
  });

  it('removes by index without touching the others', () => {
    expect(removeSegment(lane, 0).map(s => s.url)).toEqual(['b.mp4']);
  });

  it('does not let a resize invert a segment', () => {
    const next = resizeSegment(lane, 0, 'end', 0, 12);
    expect(next[0].end).toBeGreaterThan(next[0].start);
  });

  it('keeps a moved segment inside the clip', () => {
    const next = moveSegmentTo(lane, 0, -50, 12);
    expect(next[0].start).toBeGreaterThanOrEqual(0);
  });
});
