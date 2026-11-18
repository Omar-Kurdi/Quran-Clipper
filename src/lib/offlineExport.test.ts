import { describe, it, expect, vi, afterEach } from 'vitest';
import { audioSamples, canEncodeOffline } from './offlineExport';

const withCodecs = (present: boolean) => {
  for (const name of ['VideoEncoder', 'AudioEncoder', 'VideoDecoder']) {
    vi.stubGlobal(name, present ? function stub() {} : undefined);
  }
};

afterEach(() => vi.unstubAllGlobals());

describe('canEncodeOffline', () => {
  it('accepts a video background now that clips are decoded in order', () => {
    // This used to refuse them, because producing a frame for an arbitrary
    // moment meant seeking the background -- 21.9ms a frame, slower than the
    // recording it replaces. Decoding forward needs no seeking, so the
    // question is no longer about the project.
    withCodecs(true);
    expect(canEncodeOffline({ bgType: 'video', bgUrl: 'https://x.test/clip.mp4' })).toBe(true);
  });

  it('accepts stills too', () => {
    withCodecs(true);
    expect(canEncodeOffline({ bgType: 'image', bgUrl: 'https://x.test/mosque.jpg' })).toBe(true);
  });

  it('refuses when the browser has no encoder', () => {
    withCodecs(false);
    expect(canEncodeOffline({})).toBe(false);
  });

  it('refuses when there is no decoder for the background', () => {
    // Encoding without decoding would render every clip-backed frame blank.
    withCodecs(true);
    vi.stubGlobal('VideoDecoder', undefined);
    expect(canEncodeOffline({})).toBe(false);
  });
});

describe('audioSamples', () => {
  it('takes the clip from the whole recording', () => {
    expect(audioSamples({ start: 2, end: 3 }, 0, 100, 1000)).toEqual({ startSample: 200, endSample: 300 });
  });

  it("takes it from a long recording's stretch that starts partway in", () => {
    expect(audioSamples({ start: 3002, end: 3003 }, 3000, 100, 1000)).toEqual({ startSample: 200, endSample: 300 });
  });

  it('never reaches past either end of what was decoded', () => {
    expect(audioSamples({ start: 2999, end: 3020 }, 3000, 100, 1000)).toEqual({ startSample: 0, endSample: 1000 });
  });
});
