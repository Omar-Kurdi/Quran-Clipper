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

/**
 * Frames sent to the decoder and not yet back out of it. The decoder's own
 * `decodeQueueSize` cannot bound this: a hardware decoder takes input at once
 * and holds the work where that count does not see it. Sixteen is the most
 * frames H.264 may hold back for reordering, so a valid stream never needs
 * more in hand to produce its next one.
 */
const MAX_IN_FLIGHT = 16;

/** How long the decoder may go without producing a frame before it is given up on. */
const DECODE_STALL_MS = 5000;

/**
 * Hands control back so decoder output, which arrives as tasks, can land.
 * A message rather than a timer, which a hidden tab would clamp to a second.
 */
const nextTask = () =>
  new Promise<void>(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(0);
  });

interface Sample {
  chunk: EncodedVideoChunk;
}

export interface BackgroundClip {
  /** Length of the clip, in seconds. */
  duration: number;
  width: number;
  height: number;
  /**
   * How the frames are read: decoded in order, or by seeking an element --
   * which works, but costs a seek per frame. Said before an export, not after.
   */
  readsBy: 'decoder' | 'seeking';
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

/** Why a clip could not be demuxed, for the console when one cannot. */
type OpenFailure = 'fetch' | 'demux' | 'no-video-track' | 'no-samples' | 'unsupported-codec' | 'no-decoder' | 'decode-error';

/** How long to wait for one seek before drawing whatever frame is there. */
const SEEK_TIMEOUT_MS = 2000;

/** Box types an ISO base-media file can legitimately open with. */
const ISO_BMFF_OPENERS = ['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip'];

/**
 * Whether these bytes are even a candidate for the MP4 demuxer.
 *
 * An ISO base-media file opens with a box: four bytes of size, then four
 * characters of type. Matroska opens with the EBML signature instead, and
 * handing that to mp4box makes it read a length and a type out of the middle
 * of a header and report `Invalid box type` -- on `console.error`, which in
 * development is an error overlay and a red issue badge over the studio. The
 * export was fine; the message was mp4box declining a container that was never
 * its to read, once per background per render.
 *
 * There is no quieting it from outside: mp4box's own `setLogLevel` treats
 * anything above `error` as `error`, and the log site that emits this one does
 * not pass the file, so `onError` never gets the chance to swallow it. Asking
 * the question before the demuxer does is what actually stops it.
 *
 * A false yes costs nothing -- the demuxer fails as it did before and the
 * seeking path still gets its turn.
 */
function looksLikeIsoBmff(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 8) return false;
  const type = String.fromCharCode(...new Uint8Array(bytes, 4, 4));
  return ISO_BMFF_OPENERS.includes(type);
}

/**
 * The same clip, read by seeking a video element instead of demuxing.
 *
 * `openBackgroundClip` demuxes with mp4box, which reads MP4 and nothing else.
 * The upload control accepts any `video/*`, and a Matroska or WebM background
 * is an ordinary thing to have -- so when the demuxer cannot read a container,
 * the browser's own media stack is asked instead. It plays everything the
 * `<video>` element does, which is the whole point: what the studio previewed
 * is what the export renders, whatever it arrived in.
 *
 * Seeking is what the decode path exists to avoid, and this is slower. It is
 * not slower than the alternative it replaces: without it an unreadable
 * container aborts the frame-by-frame path and the whole export falls back to
 * recording in real time, at the preview's resolution and in WebM. Measured on
 * a 720x1280 AV1-in-Matroska clip, forward-only: 8.6ms median a frame, 12.1ms
 * at p90 -- about 41 seconds of seeking for a 160 second export at 30fps,
 * against the 160 the recorder would take.
 *
 * Frames are owned the way the decode path owns them: the one handed out stays
 * valid until the next call, and the clip closes it. A caller that keeps one
 * past that is holding a closed frame either way.
 */
/** A video element with the clip loaded, or null when the browser refuses it too. */
export async function loadElement(url: string): Promise<HTMLVideoElement | null> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  const loaded = await new Promise<boolean>(resolve => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    video.addEventListener('loadeddata', () => done(true), { once: true });
    video.addEventListener('error', () => done(false), { once: true });
    video.load();
  });
  return loaded && video.videoWidth ? video : null;
}

/** Moves the element to `seconds`, resolving when the frame there is showing. */
export function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise<void>(resolve => {
    // An exact re-ask fires no `seeked` at all, and waiting for one would hang
    // the render on a background that simply has not moved yet.
    if (video.currentTime === seconds) return resolve();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', done);
    video.currentTime = seconds;
  });
}

async function openSeekingClip(url: string): Promise<BackgroundClip | null> {
  if (typeof VideoFrame === 'undefined') return null;

  const video = await loadElement(url);
  if (!video) {
    console.warn(`[videoFrames] ${url.slice(0, 80)}: the browser cannot play this either; the export falls back to recording.`);
    return null;
  }

  let held: VideoFrame | null = null;

  return {
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    width: video.videoWidth,
    height: video.videoHeight,
    readsBy: 'seeking',
    close() {
      held?.close();
      held = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
    async frameAt(seconds) {
      const at = Math.max(0, seconds);
      await seekTo(video, at);
      held?.close();
      try {
        held = new VideoFrame(video, { timestamp: Math.round(at * 1e6) });
      } catch {
        // A tainted element, or one that lost its data mid-render.
        held = null;
      }
      return held;
    },
  };
}

/**
 * Opens a clip for sequential reading, or returns null when it cannot be read
 * -- an unsupported container, a codec with no decoder, a fetch that failed.
 * Null is an ordinary answer: the caller falls back to real-time recording.
 */
export async function openBackgroundClip(url: string): Promise<BackgroundClip | null> {
  // Every demux failure is a container or codec mp4box could not read, not a
  // verdict on the file -- so the seeking path gets a turn before the export
  // gives up on the background. The exception is having no WebCodecs at all,
  // where there is nothing left to try.
  const fall_back = (why: OpenFailure) => {
    console.warn(`[videoFrames] ${url.slice(0, 80)}: ${why}; reading this background by seeking instead.`);
    return openSeekingClip(url);
  };
  if (typeof VideoDecoder === 'undefined') {
    console.warn(`[videoFrames] ${url.slice(0, 80)}: no-decoder; this background keeps the real-time recorder.`);
    return null;
  }

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) return fall_back('fetch');
    bytes = await res.arrayBuffer();
  } catch {
    return fall_back('fetch');
  }

  // Ask before handing it over, so a container that is plainly not an MP4
  // goes straight to the seeking path instead of through the demuxer's
  // complaint.
  if (!looksLikeIsoBmff(bytes)) return fall_back('demux');

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

  if (!track) return fall_back('no-video-track');
  if (!ready || !samples.length) return fall_back('no-samples');

  const info = track as Record<string, unknown>;
  const timescale = info.timescale as number;
  const size = (info.video as { width: number; height: number } | undefined) || { width: 0, height: 0 };
  const width = size.width;
  const height = size.height;
  // A fragmented MP4 declares no length up front -- its samples arrive in
  // fragments after an empty header -- so the track says 0. Taken at its word,
  // nothing looped: the background ran once and froze on its last frame for
  // the rest of the render. The samples themselves say where it ends.
  const duration = (info.duration as number) / timescale
    || samples.reduce((end, { chunk }) => Math.max(end, chunk.timestamp + (chunk.duration ?? 0)), 0) / 1e6;

  const config: VideoDecoderConfig = {
    codec: info.codec as string,
    codedWidth: width,
    codedHeight: height,
    description: codecDescription(MP4Box, file as unknown as { getTrackById(id: number): unknown }, info.id as number),
  };
  try {
    const check = await VideoDecoder.isConfigSupported(config);
    if (!check.supported) return fall_back('unsupported-codec');
  } catch {
    return fall_back('unsupported-codec');
  }

  let queue: VideoFrame[] = [];
  let cursor = 0;
  let decoder: VideoDecoder | null = null;
  let failed = false;
  let lastOutputAt = 0;
  let inFlight = 0;

  const start = () => {
    decoder = new VideoDecoder({
      output: frame => { queue.push(frame); inFlight = Math.max(0, inFlight - 1); lastOutputAt = performance.now(); },
      error: () => { failed = true; },
    });
    decoder.configure(config);
    cursor = 0;
    inFlight = 0;
  };

  const reset = () => {
    queue.forEach(frame => frame.close());
    queue = [];
    try { decoder?.close(); } catch { /* already gone */ }
    start();
  };

  start();
  let lastAsked = -1;

  // Where frames come from once the decoder has failed. A decoder error used
  // to end the background for the rest of the render: `failed` was never
  // cleared, so every frame after it came back null, and a null frame paints
  // the gradient fallback -- the plain navy an Ash-Shura 42:17-18 export
  // showed from 0:28 to its end, with nothing to say why. The browser's own
  // player reads anything the preview played, so the rest of the render is
  // read by seeking instead.
  let seeking: Promise<BackgroundClip | null> | null = null;
  const bySeeking = async (seconds: number) => {
    seeking ??= fall_back('decode-error');
    const clip = await seeking;
    return clip ? clip.frameAt(seconds) : null;
  };

  const submit = () => {
    inFlight++;
    decoder!.decode(samples[cursor++].chunk);
  };

  /**
   * Feeds the decoder as far as it will go without waiting, and says what, if
   * anything, has to be waited for before the frame is out.
   */
  const feed = (untilMicros: number, began: number): 'ready' | 'output' | 'flush' => {
    while (!failed && lastFrameEnd() <= untilMicros) {
      dropBehind(untilMicros);
      if (cursor >= samples.length) return 'flush';
      if (inFlight >= MAX_IN_FLIGHT) {
        if (performance.now() - Math.max(began, lastOutputAt) > DECODE_STALL_MS) failed = true;
        return failed ? 'ready' : 'output';
      }
      submit();
    }
    return 'ready';
  };

  /**
   * Decodes until a frame covering `untilMicros` is out, with at most
   * `MAX_IN_FLIGHT` frames in the decoder at once.
   *
   * It used to decode without waiting for anything to come out. Output
   * arrives as tasks, and nothing here gave it one, so the loop ran on until
   * it had handed over the whole clip -- 237 of 240 frames in the decoder at
   * once on an 8s clip, every one of them then held as a full raw image --
   * and returned whatever the queue happened to hold. After a loop restart
   * that was one early frame: the second pass through a 15s Pexels clip drew
   * its 0.17s frame for all fifteen seconds. Now it waits for the frame it
   * was asked for, and gives the decoder up for failed if nothing comes out
   * for `DECODE_STALL_MS`.
   */
  const pump = async (untilMicros: number, began = performance.now()): Promise<void> => {
    const waitFor = feed(untilMicros, began);
    if (waitFor === 'output') {
      await nextTask();
      return pump(untilMicros, began);
    }
    // With all of it in, a decoder holds its last few frames back until it is
    // told nothing more is coming.
    if (waitFor === 'flush') await decoder!.flush().catch(() => {});
    // Keep a little decoded ahead so the next frame is usually already there.
    while (!failed && cursor < samples.length && queue.length + inFlight < QUEUE_AHEAD) submit();
  };

  const frameEnd = (frame: VideoFrame) => frame.timestamp + (frame.duration ?? 0);
  const lastFrameEnd = () => (queue.length ? frameEnd(queue[queue.length - 1]) : -1);
  /** Frames wholly before `micros` are done with; the newest is kept whatever its time. */
  const dropBehind = (micros: number) => {
    while (queue.length > 1 && frameEnd(queue[0]) <= micros) queue.shift()!.close();
  };

  return {
    duration,
    width,
    height,
    readsBy: 'decoder',
    close() {
      queue.forEach(frame => frame.close());
      queue = [];
      try { decoder?.close(); } catch { /* already gone */ }
      void seeking?.then(clip => clip?.close());
    },
    async frameAt(seconds) {
      if (failed) return bySeeking(seconds);
      // Looping is the only way time goes backwards, and a decoder cannot be
      // rewound -- so it is rebuilt. Cheap next to the alternative, and it
      // happens once per loop rather than once per frame.
      if (seconds < lastAsked) reset();
      lastAsked = seconds;

      const wanted = Math.max(0, seconds) * 1e6;
      await pump(wanted);
      if (failed) return bySeeking(seconds);
      dropBehind(wanted);
      return queue[0] ?? null;
    },
  };
}
