/**
 * The pauses in a recitation, read off its peak envelope: where a long
 * recording can be cut without cutting a word -- the edges of the stretches
 * it is matched in, a clip's ends, the marks the timeline offers.
 *
 * A reciter breathes between ayahs and often within one, and a recording's
 * quiet is never zero: room tone, a hum, a mosque's reverb. So "quiet" is
 * measured against the recording itself -- a little above its own floor,
 * well under its voice -- rather than against a fixed level, and only a run
 * of it long enough to be a breath counts.
 */

import { ENVELOPE_PER_SEC } from './longAudio';

export interface Pause {
  /** Seconds on the recording's clock. */
  start: number;
  end: number;
}

/** Shorter quiet than this is a consonant or a gap between words, not a pause. */
export const MIN_PAUSE_SEC = 0.3;

/** The value `fraction` of the way up the sorted envelope. */
function percentile(sorted: Uint8Array, fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/**
 * The level under which the envelope is quiet: a tenth of the way from the
 * recording's floor (its quietest tenth) to its voice (its loudest tenth but
 * one), and never under a few steps of the floor itself.
 */
export function quietLevel(envelope: Uint8Array): number {
  const sorted = Uint8Array.from(envelope).sort();
  const floor = percentile(sorted, 0.1);
  const voice = percentile(sorted, 0.9);
  // No voice above the floor to tell it from: nothing is quiet.
  if (voice - floor < MIN_RANGE) return 0;
  return Math.max(floor + 2, floor + (voice - floor) * 0.1);
}

/** Less between a recording's floor and its voice than this, and its quiet cannot be told from its voice. */
const MIN_RANGE = 10;

/**
 * Every pause in the recording, in order: each run of the envelope under the
 * quiet level lasting at least `minSeconds`. `perSec` is the envelope's rate.
 */
export function findPauses(envelope: Uint8Array, perSec = ENVELOPE_PER_SEC, minSeconds = MIN_PAUSE_SEC): Pause[] {
  const level = quietLevel(envelope);
  const pauses: Pause[] = [];
  let from = -1;
  for (let i = 0; i <= envelope.length; i++) {
    const quiet = i < envelope.length && envelope[i] < level;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      if ((i - from) / perSec >= minSeconds) pauses.push({ start: round(from / perSec), end: round(i / perSec) });
      from = -1;
    }
  }
  return pauses;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** The middle of the pause nearest `time` within `reach` seconds of it, or null: where to cut near `time`. */
export function pauseNear(pauses: readonly Pause[], time: number, reach: number): number | null {
  let best: number | null = null;
  for (const pause of pauses) {
    const middle = (pause.start + pause.end) / 2;
    const away = time < pause.start ? pause.start - time : time > pause.end ? time - pause.end : 0;
    if (away > reach) continue;
    if (best === null || Math.abs(middle - time) < Math.abs(best - time)) best = middle;
  }
  return best === null ? null : round(best);
}

/** The longest pause that starts and ends inside [from, to], or null. */
export function longestPauseIn(pauses: readonly Pause[], from: number, to: number): Pause | null {
  let best: Pause | null = null;
  for (const pause of pauses) {
    if (pause.start < from || pause.end > to) continue;
    if (!best || pause.end - pause.start > best.end - best.start) best = pause;
  }
  return best;
}

/**
 * A stretch with each end moved to the middle of the pause nearest it, within
 * `reach` seconds: where a stretch of a recording not matched yet is let go,
 * so it starts and ends between words. An end with no pause near stays as it
 * is; null when neither moves.
 */
export function snapToPauses(pauses: readonly Pause[], start: number, end: number, reach = 2): { start: number; end: number } | null {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const first = pauseNear(pauses, from, reach) ?? from;
  const last = pauseNear(pauses, to, reach) ?? to;
  if (last - first < 1 || (first === from && last === to)) return null;
  return { start: first, end: last };
}

/**
 * The peak envelope of decoded samples, as the server reads a long
 * recording's (`EnvelopeMeter`): the loudest sample in every 1/`perSec` s,
 * 0-255. For a recording short enough for the browser to decode.
 */
export function envelopeOf(samples: Float32Array, sampleRate: number, perSec = ENVELOPE_PER_SEC): Uint8Array {
  const step = Math.max(1, Math.round(sampleRate / perSec));
  const out = new Uint8Array(Math.ceil(samples.length / step));
  for (let b = 0; b < out.length; b++) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * step);
    for (let i = b * step; i < end; i++) {
      const abs = samples[i] < 0 ? -samples[i] : samples[i];
      if (abs > peak) peak = abs;
    }
    out[b] = Math.min(255, Math.round(peak * 255));
  }
  return out;
}
