/**
 * Encodes a clip frame by frame, as fast as the machine manages.
 *
 * The existing export records the canvas in real time through `MediaRecorder`,
 * which ties it to the browser actually painting: a ten-minute clip takes ten
 * minutes, and a backgrounded tab stops producing frames at all. That is a
 * property of *capture*, not of encoding, and WebCodecs does not capture -- it
 * is handed finished frames. So this draws frame N, encodes it, draws frame
 * N+1, with no clock involved: it runs at whatever speed the encoder sustains,
 * in a canvas that never has to be on screen.
 *
 * What it cannot do is video backgrounds. Producing a frame for an arbitrary
 * moment needs the background at that moment too, and the only way to ask an
 * HTMLVideoElement for one is to seek it -- measured here at 21.9ms median on
 * a buffered 1080x1920 clip, which is 6.3 minutes of seeking alone for a
 * ten-minute export at 30fps, and slower than real time at 60. Doing that
 * would make this path slower than the one it replaces. Stills, gradients and
 * solid colours have no such problem, so those are what it accepts;
 * `canEncodeOffline` is the gate and video backgrounds keep the recorder.
 */

import { spectrumAt, SPECTRUM_BINS } from '@/lib/spectrum';

export interface OfflineCodecs {
  video: string;
  audio: string;
  /** MP4 carries Opus legitimately, but far fewer players accept it than AAC. */
  audioIsAac: boolean;
  /**
   * The exact configuration that was accepted, ready to hand to `configure`.
   *
   * Carried rather than rebuilt because the options that make this fast are
   * not uniformly supported: asking for hardware and low latency together
   * threw "Encoder creation error" on one browser that had reported the codec
   * itself as fine. Every combination here has been through
   * `isConfigSupported`, so configuring cannot fail on options.
   */
  videoConfig: VideoEncoderConfig;
}

/**
 * H.264 profiles/levels to try, best first.
 *
 * The level has to admit the resolution: `avc1.42001f` is Baseline level 3.1
 * and is reported unsupported for 1080x1920 purely because the level is too
 * low, which reads as "no H.264 here" if the list stops there.
 */
const VIDEO_CANDIDATES = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a'];

/** AAC first: MP4 with Opus plays in browsers and VLC but not in QuickTime. */
const AUDIO_CANDIDATES: { codec: string; isAac: boolean }[] = [
  { codec: 'mp4a.40.2', isAac: true },
  { codec: 'opus', isAac: false },
];

export async function pickCodecs(
  width: number,
  height: number,
  framerate: number,
  bitrate: number,
  sampleRate: number,
  channels: number
): Promise<OfflineCodecs | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;

  // Best first: hardware and low latency are what make this faster than
  // recording, but neither is universal, so each is tried and dropped rather
  // than assumed. `prefer-hardware` is documented as a preference and still
  // refused construction in one browser, which is why it is probed like the
  // rest instead of trusted.
  const TUNINGS: Partial<VideoEncoderConfig>[] = [
    { hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime' },
    { latencyMode: 'realtime' },
    { hardwareAcceleration: 'prefer-hardware' },
    {},
  ];

  let videoConfig: VideoEncoderConfig | null = null;
  outer: for (const codec of VIDEO_CANDIDATES) {
    for (const tuning of TUNINGS) {
      const candidate: VideoEncoderConfig = { codec, width, height, bitrate, framerate, ...tuning };
      try {
        const check = await VideoEncoder.isConfigSupported(candidate);
        if (check.supported) { videoConfig = check.config ?? candidate; break outer; }
      } catch { /* try the next combination */ }
    }
  }
  if (!videoConfig) return null;
  const video = videoConfig.codec;

  for (const candidate of AUDIO_CANDIDATES) {
    try {
      const check = await AudioEncoder.isConfigSupported({
        codec: candidate.codec, sampleRate, numberOfChannels: channels, bitrate: 128_000,
      });
      if (check.supported) return { video, audio: candidate.codec, audioIsAac: candidate.isAac, videoConfig };
    } catch { /* try the next one */ }
  }
  return null;
}

/**
 * True when this project can be encoded frame by frame.
 *
 * Video backgrounds used to disqualify a project outright, because producing a
 * frame for an arbitrary moment meant seeking the background and that was
 * slower than the recording it would replace. They no longer do: `videoFrames`
 * decodes a clip in order instead, which needs no seeking at all. What is
 * still required is a decoder and a demuxer, so the check is now about the
 * browser rather than about the project.
 */
export function canEncodeOffline(_background?: unknown): boolean {
  return typeof VideoEncoder !== 'undefined'
    && typeof AudioEncoder !== 'undefined'
    && typeof VideoDecoder !== 'undefined';
}

/**
 * Bitrate for this path, deliberately below the recorder's 18 Mbps.
 *
 * The muxer holds the entire file in memory before there is a Blob at all, so
 * bitrate is a memory budget as much as a quality one: ten minutes at 18 Mbps
 * is about 1.35 GB in one buffer. 12 Mbps is still generous for 1080x1920
 * H.264 -- above what YouTube asks for at 1080p60 -- and takes that to 900 MB.
 * Measured: 30s at 60fps and 8 Mbps came out at 22.7 MB.
 */
export const OFFLINE_BITRATE = 12_000_000;

export interface OfflineExportRequest {
  /** Draws one frame into `ctx`; everything time-varying is handed to it. */
  paint: (ctx: CanvasRenderingContext2D, frame: { atSeconds: number; spectrum: Uint8Array; tick: number }) => void | Promise<void>;
  width: number;
  height: number;
  fps: number;
  /** Where the clip starts and ends on the recording, in seconds. */
  range: { start: number; end: number };
  /** The whole recording, already decoded. */
  audio: AudioBuffer;
  videoBitrate: number;
  onProgress?: (fraction: number, framesDone: number, framesTotal: number) => void;
  signal?: { aborted: boolean };
}

export interface OfflineExportResult {
  blob: Blob;
  codecs: OfflineCodecs;
  framesEncoded: number;
  /** How many times faster than the clip's own length this ran. */
  speed: number;
  elapsedMs: number;
}

/** Keeps the encoder fed without letting an unbounded queue eat memory. */
const MAX_QUEUED_FRAMES = 12;

/**
 * Hands control back to the event loop without going through a timer.
 *
 * `setTimeout` is clamped to about a second in a background tab, and this loop
 * yields whenever the encoder's queue is deep -- so building the wait on timers
 * would reintroduce the exact throttling this whole path exists to escape, and
 * an unattended export would crawl. Measured in a non-compositing window:
 * `setTimeout(1)` did not complete twenty iterations in twenty seconds.
 *
 * A `MessageChannel` message is a task the browser does not throttle, so the
 * loop keeps running at full speed with the tab hidden. Microtasks would not
 * do -- they run before the encoder's thread gets a chance to drain anything,
 * so the queue would never fall.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

export async function encodeOffline(request: OfflineExportRequest): Promise<OfflineExportResult> {
  const { paint, width, height, fps, range, audio, videoBitrate, onProgress, signal } = request;
  const started = performance.now();
  const clipSeconds = Math.max(0.1, range.end - range.start);
  const totalFrames = Math.max(1, Math.round(clipSeconds * fps));

  const codecs = await pickCodecs(width, height, fps, videoBitrate, audio.sampleRate, Math.min(2, audio.numberOfChannels));
  if (!codecs) throw new Error('This browser cannot encode H.264 with WebCodecs.');

  // Imported here rather than at the top so the muxer stays out of the initial
  // page payload -- it is only ever needed once someone actually exports.
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  const channels = Math.min(2, audio.numberOfChannels);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    audio: { codec: codecs.audioIsAac ? 'aac' : 'opus', numberOfChannels: channels, sampleRate: audio.sampleRate },
    // The whole file is produced before anything is written, so the index can
    // go at the front where a player expects it rather than after the data.
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: err => { encodeError = err as Error; },
  });
  videoEncoder.configure(codecs.videoConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: err => { encodeError = err as Error; },
  });
  audioEncoder.configure({ codec: codecs.audio, sampleRate: audio.sampleRate, numberOfChannels: channels, bitrate: 128_000 });

  // --- audio -------------------------------------------------------------
  // Encoded up front and in one pass: it is small next to the video and this
  // keeps the frame loop free of interleaving.
  const startSample = Math.max(0, Math.floor(range.start * audio.sampleRate));
  const endSample = Math.min(audio.length, Math.ceil(range.end * audio.sampleRate));
  const CHUNK = 4096;
  const interleaved = new Float32Array(CHUNK * channels);
  const channelData = Array.from({ length: channels }, (_, c) =>
    audio.getChannelData(Math.min(c, audio.numberOfChannels - 1))
  );
  for (let offset = startSample; offset < endSample; offset += CHUNK) {
    const frames = Math.min(CHUNK, endSample - offset);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) interleaved[i * channels + c] = channelData[c][offset + i];
    }
    audioEncoder.encode(new AudioData({
      format: 'f32',
      sampleRate: audio.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: Math.round(((offset - startSample) / audio.sampleRate) * 1e6),
      data: interleaved.slice(0, frames * channels),
    }));
  }

  // --- video -------------------------------------------------------------
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Could not open a drawing context for the export.');

  const mono = audio.getChannelData(0);
  const spectrum = new Uint8Array(SPECTRUM_BINS);
  const frameDuration = 1e6 / fps;
  let framesEncoded = 0;

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) break;
    if (encodeError) throw encodeError;

    const atSeconds = range.start + i / fps;
    spectrumAt(mono, audio.sampleRate, atSeconds, spectrum);
    await paint(ctx, { atSeconds, spectrum, tick: i });

    const frame = new VideoFrame(canvas as unknown as CanvasImageSource, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });
    // A keyframe every two seconds: enough for a player to seek without
    // spending a large share of the bitrate on them.
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    framesEncoded++;

    // Yield when the queue is deep, both to bound memory and to let the page
    // stay responsive -- this loop would otherwise hold the thread for the
    // whole export.
    while (videoEncoder.encodeQueueSize > MAX_QUEUED_FRAMES && !signal?.aborted) {
      await yieldToEventLoop();
    }
    if (i % Math.max(1, Math.round(fps / 2)) === 0) {
      onProgress?.(i / totalFrames, i, totalFrames);
    }
  }

  if (signal?.aborted) {
    // Close rather than flush: flushing would spend time finishing an encode
    // nobody is waiting for. Throwing distinguishes this from a failure so the
    // caller discards the partial file instead of falling back and starting a
    // second export the user did not ask for.
    videoEncoder.close();
    audioEncoder.close();
    throw Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });
  }

  await videoEncoder.flush();
  await audioEncoder.flush();
  videoEncoder.close();
  audioEncoder.close();
  if (encodeError) throw encodeError;

  muxer.finalize();
  const target = muxer.target as { buffer: ArrayBuffer };
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const elapsedMs = performance.now() - started;

  onProgress?.(1, totalFrames, totalFrames);
  return { blob, codecs, framesEncoded, elapsedMs, speed: (clipSeconds * 1000) / elapsedMs };
}
