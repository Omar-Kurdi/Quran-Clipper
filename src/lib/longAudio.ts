/**
 * Trimming a recording too long for the browser to hold.
 *
 * The trim dialog decodes the whole upload into memory, which is fine for a
 * passage and fails for a whole surah: a 1:53 recording at 48 kHz stereo is
 * about 2.6 GB of samples, and the browser gives up ("Could not read this
 * audio file for trimming"). A recording that long is read on this computer's
 * server instead (`/api/audio/long`): ffmpeg reads it once into a peak
 * envelope for the waveform, plays nothing, and cuts the stretch chosen. What
 * comes back is an ordinary recording, so the rest of the studio does not know
 * the difference.
 *
 * The rules here are pure, so they can be tested without ffmpeg or a browser.
 */

/** Longer than this, a recording is read on the server: decoded whole, half an hour at 48 kHz stereo is 690 MB. */
export const LONG_AUDIO_SEC = 30 * 60;
/**
 * The most of a long recording one trim keeps. The aligner matches about 45
 * minutes in one pass (`ALIGN_MAX_MEMORY_GB`), and the studio still decodes
 * what it keeps for the timeline's waveform and the export.
 */
export const MAX_LONG_TRIM_SEC = 40 * 60;
/** The envelope's rate: a value every 20 ms, finer than the dialog ever draws. */
export const ENVELOPE_PER_SEC = 50;
/** The rate the server reads the recording at for the envelope; plenty for a peak. */
export const ENVELOPE_SAMPLE_RATE = 8000;

export function isLongAudio(seconds: number | null | undefined): boolean {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > LONG_AUDIO_SEC;
}

/** The stretch to cut, inside the recording and no longer than one trim keeps; null when there is none. */
export function longCutWindow(start: number, end: number, duration: number): { start: number; end: number } | null {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(duration, Math.max(start, end));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 0.05) return null;
  if (to - from > MAX_LONG_TRIM_SEC + 0.05) return null;
  return { start: from, end: to };
}

/**
 * Peaks as the server reads them: the loudest sample in every 20 ms, 0-255.
 * Fed the decoded samples in whatever pieces they arrive, so a two-hour
 * recording is never held whole.
 */
export class EnvelopeMeter {
  private readonly perBucket = ENVELOPE_SAMPLE_RATE / ENVELOPE_PER_SEC;
  private readonly values: number[] = [];
  private peak = 0;
  private filled = 0;
  samples = 0;

  push(chunk: Float32Array) {
    for (let i = 0; i < chunk.length; i++) {
      const abs = Math.abs(chunk[i]);
      if (abs > this.peak) this.peak = abs;
      if (++this.filled === this.perBucket) this.close();
    }
    this.samples += chunk.length;
  }

  private close() {
    this.values.push(Math.min(255, Math.round(this.peak * 255)));
    this.peak = 0;
    this.filled = 0;
  }

  /** The envelope, and the recording's length as read: the clock the cut is made on. */
  finish(): { envelope: Uint8Array; duration: number } {
    if (this.filled > 0) this.close();
    return { envelope: Uint8Array.from(this.values), duration: this.samples / ENVELOPE_SAMPLE_RATE };
  }
}

/** The envelope drawn at `buckets` bars, 0-1: the loudest value in each bar's stretch, as `computePeaks` does. */
export function envelopePeaks(envelope: Uint8Array, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  if (!envelope.length) return peaks;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * envelope.length) / buckets);
    const end = Math.max(start + 1, Math.min(envelope.length, Math.floor(((b + 1) * envelope.length) / buckets)));
    let peak = 0;
    for (let i = start; i < end; i++) if (envelope[i] > peak) peak = envelope[i];
    peaks[b] = peak / 255;
  }
  return peaks;
}
