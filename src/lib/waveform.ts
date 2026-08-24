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

/** Enough detail for a full-width track without making the fetch pointless. */
export const WAVEFORM_BUCKETS = 900;

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
      const peaks = computePeaks(buffer, WAVEFORM_BUCKETS);
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
