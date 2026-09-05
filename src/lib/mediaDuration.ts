/**
 * How long a background clip actually runs.
 *
 * The studio knows where a background *sits* -- that is the lane -- but never
 * knew how long the footage itself is, so a five-second clip stretched across
 * thirty seconds looked exactly like a thirty-second one. Nothing in a url says
 * how long the media is, and neither the gallery nor the timeline can wait for
 * a network round trip before painting, so the answer is measured once per url
 * and remembered here for the life of the page.
 *
 * Measuring means letting the browser read the file's header: `preload =
 * 'metadata'` fetches the front of the file, not the file. A failure -- a dead
 * link, an unreadable container, a slow host -- is cached as `null` and drawn
 * as nothing at all, because a wrong length is worse than no length.
 */

const durations = new Map<string, number | null>();
const inFlight = new Map<string, Promise<number | null>>();

/** Metadata reads run few at a time: ten tiles opening should not be ten requests at once. */
const MAX_ACTIVE = 3;
const PROBE_TIMEOUT_MS = 12_000;
let active = 0;
const queue: (() => void)[] = [];

function runNext(): void {
  if (active >= MAX_ACTIVE) return;
  const next = queue.shift();
  if (!next) return;
  active++;
  next();
}

function probe(url: string): Promise<number | null> {
  return new Promise<number | null>(resolve => {
    if (typeof document === 'undefined') return resolve(null);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    // Some hosts serve media without CORS headers; the duration is readable
    // either way, and asking for credentials we do not have only fails harder.
    video.crossOrigin = 'anonymous';

    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      // Stop the fetch: an abandoned element keeps its connection open, which
      // matters when a gallery of ten is being measured three at a time.
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** The measured length, or `undefined` while it is unknown. Never blocks. */
export function knownMediaDuration(url: string): number | null | undefined {
  return durations.get(url);
}

/** Measures `url` once, ever. Repeat callers get the same promise or the cached answer. */
export function loadMediaDuration(url: string): Promise<number | null> {
  if (!url) return Promise.resolve(null);
  const cached = durations.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = inFlight.get(url);
  if (running) return running;

  const task = new Promise<number | null>(resolve => {
    queue.push(() => {
      probe(url).then(value => {
        durations.set(url, value);
        inFlight.delete(url);
        active--;
        runNext();
        resolve(value);
      });
    });
    runNext();
  });
  inFlight.set(url, task);
  return task;
}

/** `0:07`, `1:04` -- a clip length, which is read beside times in the same shape. */
export function formatClipLength(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${Math.round(safe % 60).toString().padStart(2, '0')}`;
}

/**
 * How many times a clip plays across a stretch of the lane.
 *
 * Only ever more than one: a block shorter than its clip shows part of it once,
 * which is not a repeat and is not something the user asked to see marked.
 * Rounded to one decimal because "2.4 times" is the honest answer -- the last
 * pass is usually partial.
 */
export function repeatCount(blockSeconds: number, clipSeconds: number | null | undefined): number {
  if (!clipSeconds || !(clipSeconds > 0) || !(blockSeconds > 0)) return 1;
  const times = blockSeconds / clipSeconds;
  // A hair over one is a rounding artefact of a drag, not a second play.
  return times > 1.02 ? Math.round(times * 10) / 10 : 1;
}
