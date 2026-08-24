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
 */
export async function loadWaveform(url: string, signal?: AbortSignal): Promise<Float32Array | null> {
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
      const res = await fetch(url, { signal });
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
