/**
 * Peak data for the timeline's waveform track.
 *
 * The trim editor already decodes uploaded files, but the timeline also has to
 * draw built-in reciter audio, which is remote. That works because
 * mp3quran.net serves `access-control-allow-origin: *` -- without it we could
 * not read the bytes and the timeline would fall back to a plain track.
 *
 * Results are cached per URL: decoding a ten-minute recitation is expensive and
 * the same clip is re-rendered every time the layout changes.
 */

import { computePeaks } from '@/lib/audioTrim';

const cache = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array | null>>();

/**
 * How finely the waveform is sampled, in buckets per second of audio.
 *
 * This used to be a fixed 900 buckets for any clip, which quietly made the
 * track useless on exactly the recordings people work on. 900 buckets is 76ms
 * apiece over a 68-second clip and 277ms apiece over a four-minute one -- and
 * the pauses this track exists to show are 0.2-0.5s long. Measured on a
 * four-minute recitation, 23 of its 31 silences were narrower than two buckets,
 * so each one either vanished into a neighbouring peak or drew a dip a bucket
 * away from where it happened. That is the "the gap is just before or just
 * after the dip" complaint, and it was a resolution bug rather than a sync one.
 *
 * 50/s puts a bucket every 20ms, so the aligner's shortest meaningful pause
 * (0.30s) is fifteen of them and cannot land in the wrong place.
 */
const BUCKETS_PER_SECOND = 50;

/** Floor for very short clips, so a two-second file still draws a real shape. */
const MIN_BUCKETS = 900;

/**
 * Ceiling, for memory and draw time on a long lecture. At 50/s this is reached
 * at forty minutes, beyond which resolution degrades again -- gracefully, and
 * far past where anyone is reading individual pauses off the track.
 */
const MAX_BUCKETS = 120_000;

export function bucketsFor(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return MIN_BUCKETS;
  return Math.min(MAX_BUCKETS, Math.max(MIN_BUCKETS, Math.round(durationSeconds * BUCKETS_PER_SECOND)));
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
}

/**
 * Returns peaks for `url`, or null when the audio cannot be read -- a
 * cross-origin server without CORS, an unsupported codec, or an offline fetch.
 * Null is a normal outcome, not an error: the caller draws a plain track.
 *
 * Deliberately takes no AbortSignal. The work is shared between every caller
 * asking for the same url, so letting one of them cancel it poisons the result
 * for the others: React's development double-mount aborted the very fetch the
 * second mount was waiting on, and the timeline reported the waveform
 * unavailable for audio that had downloaded fine. A caller that no longer
 * wants the answer should ignore it rather than cancel it -- the fetch is
 * cached, so finishing it costs nothing and warms the next request.
 */
export async function loadWaveform(url: string): Promise<Float32Array | null> {
  if (!url) return null;
  const cached = cache.get(url);
  if (cached) return cached;

  const existing = inflight.get(url);
  if (existing) return existing;

  const job = (async () => {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    const ctx = new Ctor();
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      const peaks = computePeaks(buffer, bucketsFor(buffer.duration));
      cache.set(url, peaks);
      return peaks;
    } catch {
      return null;
    } finally {
      ctx.close().catch(() => {});
      inflight.delete(url);
    }
  })();

  inflight.set(url, job);
  return job;
}
