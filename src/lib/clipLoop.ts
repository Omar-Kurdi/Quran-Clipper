/**
 * The part of a background clip that loops.
 *
 * Stock footage often opens or closes on black: the Pexels night-sky clip in a
 * Fatir 35:5-7 export ends with 0.47 s of it (40.37 s to 40.84 s, measured on
 * the file itself with ffmpeg). Looped whole, every pass through the clip
 * blanked the background for that long -- in the export and the preview alike,
 * since both play the file as it is. Nobody picks a background for its black
 * frames, so a decorative clip loops between its first and last frames that
 * have a picture, and the black at either end is never shown.
 *
 * Found once per url by looking at the frames, and shared: the preview, the
 * export and the timeline all ask, and all get the same window. A clip whose
 * window cannot be measured -- a host without CORS, a file the browser cannot
 * seek -- loops whole, exactly as before.
 */

import { loadElement, seekTo } from './videoFrames';

export interface LoopWindow {
  /** First moment with a picture, in seconds into the clip. */
  start: number;
  /** Where the picture ends: the loop goes back to `start` here. */
  end: number;
}

/** Mean brightness (0-255) below which a frame counts as black. A night sky measures 45-75. */
export const BLACK_LUMA = 10;

/** The most black trimmed from either end. A clip that is dark for longer than this is meant to be dark. */
export const MAX_EDGE_SEC = 1.5;

/** The shortest loop left after trimming; anything shorter keeps the whole clip. */
const MIN_LOOP_SEC = 1;

/** Coarse step when walking in from an edge, before the boundary is narrowed down. */
const STEP_SEC = 0.1;

/** How finely the boundary between black and picture is found -- well under one frame at 60 fps. */
const RESOLUTION_SEC = 0.004;

/** Where `elapsed` seconds into a block falls inside the clip, looping over `window`. */
export function loopPhase(loop: LoopWindow, elapsed: number): number {
  const length = loop.end - loop.start;
  const into = Math.max(0, elapsed);
  return length > 0 ? loop.start + (into % length) : into;
}

/**
 * The window to loop `duration` seconds of clip over: `loop` when it fits this
 * clip, else the whole of it.
 *
 * The window was measured on a video element and is used on whatever reads the
 * clip -- the decoder on export, which knows its own length. If the two
 * disagree about the clip, the measurement is not trusted: a host that cannot
 * serve byte ranges once had the element report a length of about five seconds
 * for a forty-second file, and looping on that would have cut the background
 * down to its first five. Trimming is only ever off the ends, so a window that
 * starts or stops further in than `MAX_EDGE_SEC` is not one this module made
 * for this clip.
 */
export function loopFor(loop: LoopWindow | null | undefined, duration: number): LoopWindow {
  const whole = { start: 0, end: duration };
  if (!loop || !(duration > 0)) return whole;
  const slack = STEP_SEC;
  const fits = loop.start >= 0 && loop.start <= MAX_EDGE_SEC + slack
    && loop.end <= duration + slack && loop.end >= duration - MAX_EDGE_SEC - slack
    && loop.end - loop.start >= MIN_LOOP_SEC;
  return fits ? { start: loop.start, end: Math.min(loop.end, duration) } : whole;
}

/**
 * Where the picture starts and ends, given a way to ask whether the frame at a
 * moment is black.
 *
 * Walks in from each end in `STEP_SEC` steps until it finds a picture, then
 * halves the gap down to `RESOLUTION_SEC`. A clip with no black ends costs two
 * questions. Any doubt keeps the whole clip: black that runs past `MAX_EDGE_SEC`,
 * or a window that would leave less than `MIN_LOOP_SEC`.
 */
export async function findLoopWindow(
  duration: number,
  isBlackAt: (seconds: number) => Promise<boolean>
): Promise<LoopWindow> {
  const whole = { start: 0, end: duration };
  if (!(duration > MIN_LOOP_SEC)) return whole;

  // The last instant that still belongs to the clip, rather than its end,
  // which is past every frame.
  const last = Math.max(0, duration - RESOLUTION_SEC);

  // Each question seeks the one element, so they are asked one after another:
  // there is nothing to run in parallel.

  /** Steps in from a black `black` until a picture, giving up past `MAX_EDGE_SEC`. */
  const walk = async (from: number, inward: 1 | -1, step: number): Promise<[number, number] | null> => {
    if (step > MAX_EDGE_SEC + 1e-9) return null;
    const at = from + inward * step;
    if (!(await isBlackAt(at))) return [from + inward * (step - STEP_SEC), at];
    return walk(from, inward, step + STEP_SEC);
  };

  /** Halves the gap between a black moment and a picture down to `RESOLUTION_SEC`. */
  const narrow = async (black: number, picture: number): Promise<number> => {
    if (Math.abs(picture - black) <= RESOLUTION_SEC) return picture;
    const middle = (picture + black) / 2;
    return (await isBlackAt(middle)) ? narrow(middle, picture) : narrow(black, middle);
  };

  const edge = async (from: number, inward: 1 | -1): Promise<number | null> => {
    if (!(await isBlackAt(from))) return null;
    const gap = await walk(from, inward, STEP_SEC);
    return gap ? narrow(gap[0], gap[1]) : null;
  };

  const start = (await edge(0, 1)) ?? 0;
  const end = (await edge(last, -1)) ?? duration;
  return end - start >= MIN_LOOP_SEC ? { start, end } : whole;
}

const windows = new Map<string, LoopWindow | null>();
const measuring = new Map<string, Promise<LoopWindow | null>>();

/** The window already measured for `url`: null when it could not be, undefined while unknown. Never blocks. */
export function knownLoopWindow(url: string): LoopWindow | null | undefined {
  return windows.get(url);
}

/** Mean brightness of whatever frame `video` is showing, or null when its pixels cannot be read. */
function meanLuma(video: HTMLVideoElement, ctx: CanvasRenderingContext2D): number | null {
  try {
    ctx.drawImage(video, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return sum / (data.length / 4);
  } catch {
    // A host without CORS taints the canvas, and reading it throws.
    return null;
  }
}

/** Measures `url` once, ever: the loop window, or null when the frames cannot be looked at. */
export function loadLoopWindow(url: string): Promise<LoopWindow | null> {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  const known = windows.get(url);
  if (known !== undefined) return Promise.resolve(known);
  const running = measuring.get(url);
  if (running) return running;

  const task = (async (): Promise<LoopWindow | null> => {
    const video = await loadElement(url);
    if (!video) return null;
    try {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return null;
      const canvas = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      let unreadable = false;
      const found = await findLoopWindow(duration, async seconds => {
        if (unreadable) return false;
        await seekTo(video, seconds);
        const luma = meanLuma(video, ctx);
        if (luma === null) unreadable = true;
        return luma !== null && luma < BLACK_LUMA;
      });
      return unreadable ? null : found;
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  })().catch(() => null).then(found => {
    windows.set(url, found);
    measuring.delete(url);
    return found;
  });
  measuring.set(url, task);
  return task;
}
