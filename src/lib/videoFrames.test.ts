import { describe, it, expect, vi, afterEach } from 'vitest';

// One two-second H.264 track, handed over the way mp4box hands it over. Only
// the decode path's tests use it; the others never get past the header check.
// `declared` is the length the track header states, which a fragmented MP4
// leaves at 0.
const declared = vi.hoisted(() => ({ duration: 2000, samples: 2 }));
vi.mock('mp4box', () => ({
  createFile: () => {
    const file: Record<string, unknown> = {
      getTrackById: () => ({}),
      setExtractionOptions: () => {},
      appendBuffer: () => (file.onReady as (info: unknown) => void)({
        videoTracks: [{ id: 1, nb_samples: declared.samples, timescale: 1000, duration: declared.duration, codec: 'avc1.64001f', video: { width: 720, height: 1280 } }],
      }),
      start: () => (file.onSamples as (id: number, user: unknown, samples: unknown[]) => void)(1, null,
        Array.from({ length: declared.samples }, (_, i) => {
          const each = declared.duration / declared.samples || 1000;
          return { is_sync: i === 0, cts: i * each, duration: each, data: new Uint8Array(4) };
        })
      ),
      flush: () => {},
    };
    return file;
  },
  DataStream: class {},
}));
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

/** An MP4 for the decode path: the header check passes and mp4box's mock answers. */
const serveMp4 = () => {
  const mp4 = new Uint8Array(64);
  mp4.set([...'ftyp'].map(c => c.charCodeAt(0)), 4);
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => mp4.buffer }));
  vi.stubGlobal('EncodedVideoChunk', class {
    timestamp: number;
    duration: number;
    constructor(init: { timestamp: number; duration: number }) { this.timestamp = init.timestamp; this.duration = init.duration; }
  });
};

/** A decoder the page can configure, with `methods` for the rest. */
const stubDecoder = (decoder: new (init: never) => object) =>
  vi.stubGlobal('VideoDecoder', Object.assign(decoder, { isConfigSupported: async () => ({ supported: true }) }));

/** Asks for each time in order, the way a render does, and lists the frame times handed back. */
const walk = (clip: { duration: number; frameAt(s: number): Promise<VideoFrame | null> }, times: number[]) =>
  times.reduce<Promise<number[]>>(
    async (done, t) => [...(await done), (await clip.frameAt(t % clip.duration))!.timestamp / 1e6],
    Promise.resolve([])
  );

describe('openBackgroundClip after a decoder error', () => {
  it('reads the rest of the render by seeking when the decoder fails', async () => {
    // A decoder error used to end the background for good: every frame after
    // it came back null, and the export painted plain navy to the end. An
    // Ash-Shura 42:17-18 render lost its background at 0:28 and never got it
    // back.
    serveMp4();
    stubDecoder(class {
      decodeQueueSize = 0;
      private fail: (e: Error) => void;
      constructor(init: { error: (e: Error) => void }) { this.fail = init.error; }
      configure() {}
      decode() { queueMicrotask(() => this.fail(new Error('Codec reclaimed'))); }
      async flush() {}
      close() {}
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = fakeVideoElement({ loads: true });
    stubBrowser(el);

    const clip = await openBackgroundClip('blob:mp4');
    expect(await clip!.frameAt(1.5)).not.toBeNull();
    expect(el.currentTime).toBe(1.5);
    expect(lastFrameTimestamp).toBe(1_500_000);
    expect(await clip!.frameAt(1.8)).not.toBeNull();
  });
});

describe('openBackgroundClip on a fragmented MP4', () => {
  it('takes the length from the samples, so the clip still loops', async () => {
    // The header of a fragmented MP4 says 0s, and a 0s clip was never looped:
    // the background played once and froze on its last frame.
    declared.duration = 0;
    try {
      serveMp4();
      stubDecoder(class { configure() {} close() {} });
      const clip = await openBackgroundClip('blob:fragmented');
      expect(clip!.duration).toBe(2);
    } finally {
      declared.duration = 2000;
    }
  });
});

describe('openBackgroundClip reading ahead', () => {
  it('hands out the frame for each moment, a bounded few frames ahead, loop after loop', async () => {
    // Output arrives as tasks. The decoder used to be fed the whole clip
    // without waiting for any -- 237 of 240 frames in flight on a real 8s
    // clip -- and whatever the queue held was drawn, so after a loop a 15s
    // background froze on one early frame for the whole pass.
    declared.duration = 3000;
    declared.samples = 30;
    try {
      serveMp4();
      let inFlight = 0;
      stubDecoder(class {
        decodeQueueSize = 0;
        private emit: (frame: unknown) => void;
        constructor(init: { output: (frame: unknown) => void }) { this.emit = init.output; }
        configure() {}
        decode(chunk: { timestamp: number; duration: number }) {
          inFlight = Math.max(inFlight, ++this.decodeQueueSize);
          setTimeout(() => {
            this.decodeQueueSize--;
            this.emit({ timestamp: chunk.timestamp, duration: chunk.duration, codedWidth: 720, close() {} });
          }, 0);
        }
        async flush() { await new Promise(r => setTimeout(r, 1)); }
        close() {}
      });

      const times = Array.from({ length: 36 }, (_, i) => i * 0.25);
      const drawn = await walk((await openBackgroundClip('blob:looping'))!, times);
      // Each 0.1s frame covering its moment, pass after pass.
      expect(drawn.map(s => s.toFixed(1))).toEqual(times.map(t => (Math.floor((t % 3) * 10 + 1e-9) / 10).toFixed(1)));
      expect(inFlight).toBeLessThanOrEqual(16);
    } finally {
      declared.duration = 2000;
      declared.samples = 2;
    }
  });
});
