import { describe, it, expect } from 'vitest';
import { canEncodeOffline } from './offlineExport';

describe('canEncodeOffline', () => {
  it('refuses a video background', () => {
    // Not a limitation to hide: producing a frame for an arbitrary moment
    // needs the background at that moment, and seeking a video per frame was
    // measured at 21.9ms -- slower than the real-time path it would replace.
    expect(canEncodeOffline({ bgType: 'video' })).toBe(false);
  });

  it('refuses a still-typed background whose URL is actually a clip', () => {
    // bgType is a mode, not proof of the file. The default project background
    // is a Pexels .mp4.
    expect(canEncodeOffline({ bgType: 'image', bgUrl: 'https://x.test/a-18953366.mp4' })).toBe(false);
  });

  it('accepts stills', () => {
    expect(canEncodeOffline({ bgType: 'image', bgUrl: 'https://x.test/mosque.jpg' })).toBe(true);
    expect(canEncodeOffline({ bgType: 'gradient' })).toBe(true);
  });

  it('checks every background in a playlist, not just the first', () => {
    expect(canEncodeOffline({
      bgType: 'image',
      bgUrls: ['https://x.test/a.jpg', 'https://x.test/b.webm'],
    })).toBe(false);
  });

  it('checks the ones pinned to segments too', () => {
    expect(canEncodeOffline({
      bgType: 'image',
      bgSegments: [{ url: 'https://x.test/a.jpg' }, { url: 'https://x.test/c.mov' }],
    })).toBe(false);
  });

  it('is not fooled by a query string after the extension', () => {
    expect(canEncodeOffline({ bgType: 'image', bgUrl: 'https://x.test/clip.mp4?dl=1' })).toBe(false);
  });

  it('does not mistake a filename that merely mentions a format', () => {
    expect(canEncodeOffline({ bgType: 'image', bgUrl: 'https://x.test/mp4-poster.jpg' })).toBe(true);
  });
});
