/**
 * Decodes a background clip in order, so a frame can be had for any moment
 * without seeking.
 *
 * The offline encoder needs the background as it looked at frame N's moment.
 * Asking an `HTMLVideoElement` means seeking it, measured at 21.9ms median on
 * a buffered 1080x1920 clip -- 6.3 minutes of seeking alone for a ten-minute
 * export at 30fps, and slower than real time at 60. That is why video
 * backgrounds were left on the real-time recorder.
 *
 * Seeking is only needed because a video element is asked for arbitrary
 * moments. Nothing about the render requires that: output time only moves
 * forward, and a background loops, so its own time sweeps 0 to its duration
 * over and over. Read in that order there is no seeking at all -- demux once,
 * decode forward, and hand out each frame as its moment arrives. Restarting at
 * a loop is the only rewind, and it is a decoder reset rather than a seek.
 */

/** Frames held ahead of the one being asked for. Bounded: each is a full raw image. */
const QUEUE_AHEAD = 6;

interface Sample {
  chunk: EncodedVideoChunk;
}

export interface BackgroundClip {
  /** Length of the clip, in seconds. */
  duration: number;
  width: number;
  height: number;
  /**
   * The frame covering `seconds` into the clip. Times must not go backwards
   * except to loop, which is detected and restarts the decode.
   */
  frameAt(seconds: number): Promise<VideoFrame | null>;
  close(): void;
}

/** Pulls the codec's setup bytes (avcC/hvcC/av1C/vpcC) out of the track header. */
function codecDescription(
  MP4Box: { DataStream: new (b: undefined, o: number, e: unknown) => { buffer: ArrayBuffer }; },
  file: { getTrackById(id: number): unknown },
  trackId: number
): Uint8Array | undefined {
  const trak = file.getTrackById(trackId) as {
    mdia?: { minf?: { stbl?: { stsd?: { entries?: Record<string, unknown>[] } } } };
  };
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries || []) {
    const box = (entry.avcC || entry.hvcC || entry.av1C || entry.vpcC) as
      | { write(stream: unknown): void }
      | undefined;
    if (!box) continue;
    const BIG_ENDIAN = (MP4Box.DataStream as unknown as { BIG_ENDIAN: unknown }).BIG_ENDIAN;
    const stream = new MP4Box.DataStream(undefined, 0, BIG_ENDIAN);
    box.write(stream);
    // mp4box writes a whole box; a decoder wants the payload, so the eight
    // bytes of size and type come off the front.
    return new Uint8Array(stream.buffer, 8);
  }
  return undefined;
}

/** Why a clip could not be opened, for the console when one cannot. */
type OpenFailure = 'fetch' | 'demux' | 'no-video-track' | 'no-samples' | 'unsupported-codec' | 'no-decoder';

/**
 * Opens a clip for sequential reading, or returns null when it cannot be read
 * -- an unsupported container, a codec with no decoder, a fetch that failed.
 * Null is an ordinary answer: the caller falls back to real-time recording.
 */
export async function openBackgroundClip(url: string): Promise<BackgroundClip | null> {
  const give_up = (why: OpenFailure) => {
    console.warn(`[videoFrames] ${url.slice(0, 80)}: ${why}; this background keeps the real-time recorder.`);
    return null;
  };
  if (typeof VideoDecoder === 'undefined') return give_up('no-decoder');

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) return give_up('fetch');
    bytes = await res.arrayBuffer();
  } catch {
    return give_up('fetch');
  }

  const MP4Box = (await import('mp4box')) as unknown as {
    createFile(): Record<string, unknown>;
    DataStream: new (b: undefined, o: number, e: unknown) => { buffer: ArrayBuffer };
  };
  const file = MP4Box.createFile();
  const samples: Sample[] = [];
  let track: Record<string, unknown> | null = null;

  // One pass: `onReady` fires while the buffer is being parsed, and extraction
  // can only be asked for once the track id is known -- so the request goes in
  // from inside the handler and `start` replays what has already been read.
  const ready = await new Promise<boolean>(resolve => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };

    file.onError = () => done(false);
    file.onReady = (info: Record<string, unknown>) => {
      track = (info.videoTracks as Record<string, unknown>[] | undefined)?.[0] ?? null;
      if (!track) return done(false);
      (file as { setExtractionOptions(id: number, user: unknown, o: unknown): void })
        // The track's own sample count. mp4box holds samples back until it has
        // this many, so asking for more than the file contains means `onSamples`
        // is never called at all.
        .setExtractionOptions(track.id as number, null, { nbSamples: track.nb_samples as number });
      (file as { start(): void }).start();
    };
    file.onSamples = (_id: number, _user: unknown, incoming: Record<string, unknown>[]) => {
      const timescale = (track?.timescale as number) || 1;
      for (const sample of incoming) {
        samples.push({
          chunk: new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: ((sample.cts as number) / timescale) * 1e6,
            duration: ((sample.duration as number) / timescale) * 1e6,
            data: sample.data as BufferSource,
          }),
        });
      }
      done(true);
    };

    const buffer = bytes as ArrayBuffer & { fileStart?: number };
    buffer.fileStart = 0;
    (file as { appendBuffer(b: ArrayBuffer): void }).appendBuffer(buffer);
    (file as { flush(): void }).flush();
    setTimeout(() => done(false), 20000);
  });

  if (!track) return give_up('no-video-track');
  if (!ready || !samples.length) return give_up('no-samples');

  const info = track as Record<string, unknown>;
  const timescale = info.timescale as number;
  const size = (info.video as { width: number; height: number } | undefined) || { width: 0, height: 0 };
  const width = size.width;
  const height = size.height;
  const duration = (info.duration as number) / timescale;

  const config: VideoDecoderConfig = {
    codec: info.codec as string,
    codedWidth: width,
    codedHeight: height,
    description: codecDescription(MP4Box, file as unknown as { getTrackById(id: number): unknown }, info.id as number),
  };
  try {
    const check = await VideoDecoder.isConfigSupported(config);
    if (!check.supported) return give_up('unsupported-codec');
  } catch {
    return give_up('unsupported-codec');
  }

  let queue: VideoFrame[] = [];
  let cursor = 0;
  let decoder: VideoDecoder | null = null;
  let failed = false;

  const start = () => {
    decoder = new VideoDecoder({
      output: frame => queue.push(frame),
      error: () => { failed = true; },
    });
    decoder.configure(config);
    cursor = 0;
  };

  const reset = () => {
    queue.forEach(frame => frame.close());
    queue = [];
    try { decoder?.close(); } catch { /* already gone */ }
    start();
  };

  start();
  let lastAsked = -1;

  const pump = async (untilMicros: number) => {
    while (!failed && (queue.length < QUEUE_AHEAD || lastFrameEnd() < untilMicros)) {
      if (cursor >= samples.length) break;
      decoder!.decode(samples[cursor++].chunk);
      if (decoder!.decodeQueueSize > QUEUE_AHEAD * 2) {
        await new Promise<void>(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
      }
    }
    if (cursor >= samples.length && queue.length === 0) await decoder!.flush().catch(() => {});
  };

  const lastFrameEnd = () => {
    const last = queue[queue.length - 1];
    return last ? last.timestamp + (last.duration ?? 0) : -1;
  };

  return {
    duration,
    width,
    height,
    close() {
      queue.forEach(frame => frame.close());
      queue = [];
      try { decoder?.close(); } catch { /* already gone */ }
    },
    async frameAt(seconds) {
      if (failed) return null;
      // Looping is the only way time goes backwards, and a decoder cannot be
      // rewound -- so it is rebuilt. Cheap next to the alternative, and it
      // happens once per loop rather than once per frame.
      if (seconds < lastAsked) reset();
      lastAsked = seconds;

      const wanted = Math.max(0, seconds) * 1e6;
      await pump(wanted);
      // Drop frames already behind the moment being drawn.
      while (queue.length > 1 && queue[0].timestamp + (queue[0].duration ?? 0) <= wanted) {
        queue.shift()!.close();
      }
      return queue[0] ?? null;
    },
  };
}
