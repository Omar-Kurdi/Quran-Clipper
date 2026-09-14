import { describe, it, expect, vi, afterEach } from 'vitest';
import { openBackgroundClip } from './videoFrames';

/**
 * The first bytes of a Matroska file: the EBML header, then `matroska` as the
 * doc type. Nothing about it is a box, which is the point -- mp4box reads a
 * size and a four-character type, and what it finds here is neither.
 */
const matroska = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01], 0);
  bytes.set([...'matroska'].map(c => c.charCodeAt(0)), 24);
  return bytes.buffer;
};

/**
 * Enough of a video element for the seeking path: it loads, it has a size, and
 * a seek completes. `seeked` fires asynchronously, the way the real one does.
 */
const fakeVideoElement = (opts: { loads: boolean; width?: number }) => {
  const listeners = new Map<string, (() => void)[]>();
  const el = {
    crossOrigin: '', muted: false, playsInline: false, preload: '', src: '',
    currentTime: -1,
    duration: 160,
    videoWidth: opts.loads ? (opts.width ?? 720) : 0,
    videoHeight: opts.loads ? 1280 : 0,
    seeks: 0,
    addEventListener(type: string, fn: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      if (type === 'seeked') queueMicrotask(() => { el.seeks++; fn(); });
    },
    removeEventListener() {},
    load() { queueMicrotask(() => (listeners.get(opts.loads ? 'loadeddata' : 'error') ?? []).forEach(fn => fn())); },
    pause() {},
    removeAttribute() {},
  };
  return el;
};

/** The timestamp the last constructed frame was given, so no cast is needed to read it. */
let lastFrameTimestamp = -1;

const stubBrowser = (el: unknown) => {
  vi.stubGlobal('VideoFrame', class {
    constructor(_source: unknown, init: { timestamp: number }) { lastFrameTimestamp = init.timestamp; }
    close() {}
  });
  vi.stubGlobal('document', { createElement: () => el });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('openBackgroundClip', () => {
  const serveMatroska = () => {
    vi.stubGlobal('VideoDecoder', function stub() {});
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => matroska() }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  };

  it('reads a container it cannot demux by seeking instead', async () => {
    // The bug this is here for: mp4box demuxes MP4 and the upload control
    // accepts any `video/*`, so an MKV background failed to open and the
    // render carried on and painted its gradient fallback in place of the
    // clip. An export came back without the video in it and nothing said why.
    serveMatroska();
    const el = fakeVideoElement({ loads: true });
    stubBrowser(el);

    const clip = await openBackgroundClip('blob:matroska');
    expect(clip).not.toBeNull();
    expect(clip!.width).toBe(720);
    expect(clip!.height).toBe(1280);

    const frame = await clip!.frameAt(1.5);
    expect(frame).not.toBeNull();
    expect(el.currentTime).toBe(1.5);
    expect(lastFrameTimestamp).toBe(1_500_000);

    // And quietly: mp4box reports a container it cannot read on `console.error`,
    // which development turns into an error overlay over the studio. Bytes that
    // are plainly not an MP4 never reach it.
    expect(console.error).not.toHaveBeenCalled();
  });

  it('gives up only when the browser cannot play the file either', async () => {
    serveMatroska();
    stubBrowser(fakeVideoElement({ loads: false }));

    await expect(openBackgroundClip('blob:unplayable')).resolves.toBeNull();
  });

  it('gives up when there is no decoder at all', async () => {
    vi.stubGlobal('VideoDecoder', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(openBackgroundClip('blob:anything')).resolves.toBeNull();
  });
});
