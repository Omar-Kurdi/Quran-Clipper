/**
 * Whether a finished render is the clip that was asked for.
 *
 * `exportHealth` watches the render while it runs; this reads the file after.
 * The faults it looks for are the ones found by hand in renders that had
 * already been posted: a beginning cut off, a background that vanished or
 * froze part way, a length that was not the trim's. Each is cheap to measure
 * and invisible until someone watches the whole thing.
 *
 * This file is the arithmetic, pure so it can be tested; `renderCheckRunner`
 * reads the file in the browser and hands the measurements here.
 */

export type CheckState = 'ok' | 'problem' | 'unsure';

export interface CheckItem {
  id: 'length' | 'start' | 'end' | 'background';
  state: CheckState;
  /** Seconds, for length/start/end: the measured value and what was expected. */
  measured?: number;
  expected?: number;
  /** For the background: the stretches of the render that are wrong, and how. */
  spans?: { kind: 'missing' | 'still'; start: number; end: number }[];
}

/** A length within this of the trim is the trim: one frame of rounding, and the muxer's padding. */
export function lengthCheck(measured: number, expected: number, fps: number): CheckItem {
  if (!Number.isFinite(measured) || measured <= 0) return { id: 'length', state: 'unsure', expected };
  const slack = Math.max(2 / fps, 0.1);
  return { id: 'length', state: Math.abs(measured - expected) <= slack ? 'ok' : 'problem', measured, expected };
}

/**
 * The shift of `probe` against `reference` that lines them up best, in
 * buckets: `probe[i]` matches `reference[i + lag]`. Scored by normalised
 * correlation, so a quiet recording and a loud one compare the same way.
 */
export function bestLag(
  reference: ArrayLike<number>,
  probe: ArrayLike<number>,
  minLag: number,
  maxLag: number
): { lag: number; score: number } {
  let best = { lag: 0, score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = correlation(reference, probe, lag);
    if (score > best.score) best = { lag, score };
  }
  return best;
}

function correlation(reference: ArrayLike<number>, probe: ArrayLike<number>, lag: number): number {
  let n = 0, sumA = 0, sumB = 0;
  for (let i = 0; i < probe.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= reference.length) continue;
    n++; sumA += reference[j]; sumB += probe[i];
  }
  if (n < 2) return -Infinity;
  const meanA = sumA / n, meanB = sumB / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < probe.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= reference.length) continue;
    const a = reference[j] - meanA, b = probe[i] - meanB;
    cov += a * b; varA += a * a; varB += b * b;
  }
  return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : -Infinity;
}

/** An offset this small is the codec's priming, not a cut. */
const EDGE_SLACK = 0.06;
/** Below this correlation the window is too quiet, or too unlike, to say anything. */
const MIN_SCORE = 0.6;
/** Peaks varying less than this over the window are silence, with nothing to line up. */
const MIN_SPREAD = 0.05;
/** How much audio each edge is compared over. */
export const EDGE_WINDOW = 6;
/** How far either way an edge is searched for. */
const MAX_SHIFT = 5;

/**
 * Where the render's first (or last) seconds actually came from in the
 * recording, against where the trim says they should.
 *
 * Both envelopes are peaks per bucket at the same `rate`. The source is the
 * whole recording; `rendered` is the render's own audio. A render that
 * started late measures a start after the trim's: its first second is audio
 * from later in the recording.
 */
export function edgeCheck(
  edge: 'start' | 'end',
  source: ArrayLike<number>,
  rendered: ArrayLike<number>,
  rate: number,
  range: { start: number; end: number }
): CheckItem {
  const window = Math.round(EDGE_WINDOW * rate);
  const shift = Math.round(MAX_SHIFT * rate);
  const renderedFrom = edge === 'start' ? 0 : Math.max(0, rendered.length - window);
  const probe = Array.from({ length: Math.min(window, rendered.length) }, (_, i) => rendered[renderedFrom + i]);
  // Where that stretch should sit in the recording, if the render is right.
  const expectedAt = (edge === 'start' ? range.start : range.start + renderedFrom / rate) * rate;
  const referenceFrom = Math.max(0, Math.round(expectedAt) - shift);
  const reference = Array.from(
    { length: Math.max(0, Math.min(source.length - referenceFrom, probe.length + shift * 2)) },
    (_, i) => source[referenceFrom + i]
  );
  const expected = edge === 'start' ? range.start : range.end;
  // Silence correlates with anything: its shape is noise.
  if (Math.max(...probe) - Math.min(...probe) < MIN_SPREAD) return { id: edge, state: 'unsure', expected };
  const { lag, score } = bestLag(reference, probe, 0, reference.length - probe.length);
  if (!(score >= MIN_SCORE)) return { id: edge, state: 'unsure', expected };
  // Where in the recording the render's first -- or last -- audio really is.
  const foundAt = (referenceFrom + lag) / rate;
  const measured = edge === 'start' ? foundAt : foundAt + probe.length / rate;
  return { id: edge, state: Math.abs(measured - expected) <= EDGE_SLACK ? 'ok' : 'problem', measured, expected };
}

/** A small grid of mean colours over one region of a frame: [r, g, b] per cell. */
export type Patch = number[][];

/** The fallback gradient's stops, as `paintFrame` draws them when there is no background. */
const FALLBACK_STOPS: [number, number[]][] = [[0, [15, 23, 42]], [0.5, [2, 6, 23]], [1, [30, 27, 75]]];
const OVERLAY = [2, 6, 23];

/** The colour the fallback gradient has at height `y` (0 to 1), under the dark overlay. */
export function fallbackColour(y: number, overlayOpacity: number): number[] {
  const upper = FALLBACK_STOPS.findIndex(([at]) => at >= y);
  const [toAt, to] = FALLBACK_STOPS[Math.max(1, upper)];
  const [fromAt, from] = FALLBACK_STOPS[Math.max(0, Math.max(1, upper) - 1)];
  const t = toAt > fromAt ? Math.min(1, Math.max(0, (y - fromAt) / (toAt - fromAt))) : 0;
  const a = overlayOpacity / 100;
  return from.map((c, i) => (c + (to[i] - c) * t) * (1 - a) + OVERLAY[i] * a);
}

/** Mean difference per channel beyond which a patch is not the fallback: the codec shifts colours by a few levels. */
const FALLBACK_TOLERANCE = 6;
/**
 * Mean change per channel between samples below which the picture is not
 * moving. Measured on a render over a calm night-sky clip: a second apart it
 * never changed by less than 0.9 of a level. A frozen picture re-encoded is
 * the same frame to within the codec's noise, well under this.
 */
const STILL_BELOW = 0.5;
/** How long a video background may look still before it is worth saying. */
const STILL_FOR = 3;

/** Whether a patch is the plain fallback, cell by cell against the gradient at each cell's height. */
export function isFallback(patch: Patch, rowHeights: number[], overlayOpacity: number): boolean {
  let total = 0, n = 0;
  patch.forEach((cell, index) => {
    const expected = fallbackColour(rowHeights[index], overlayOpacity);
    cell.forEach((value, channel) => { total += Math.abs(value - expected[channel]); n++; });
  });
  return n > 0 && total / n <= FALLBACK_TOLERANCE;
}

export function patchChange(a: Patch, b: Patch): number {
  let total = 0, n = 0;
  a.forEach((cell, i) => cell.forEach((value, c) => { total += Math.abs(value - (b[i]?.[c] ?? value)); n++; }));
  return n ? total / n : 0;
}

export interface BackgroundSample {
  /** Seconds into the render. */
  time: number;
  patch: Patch;
  /** What the lane says is behind the text here. */
  expected: 'video' | 'image' | 'none';
}

/** Joins flagged sample times into spans, each reaching to the next sample. */
function spans(times: number[], step: number, kind: 'missing' | 'still') {
  const out: { kind: 'missing' | 'still'; start: number; end: number }[] = [];
  for (const time of times) {
    const last = out[out.length - 1];
    if (last && time - last.end <= step * 1.01) last.end = time + step;
    else out.push({ kind, start: time, end: time + step });
  }
  return out;
}

/**
 * Where the background is not what the lane promised: the plain gradient
 * where a clip or still should be, or a clip that has stopped moving for a
 * few seconds. A gap in the lane is expected to be the gradient, and is not
 * reported here -- the export dialog warned about it before the render.
 */
export function backgroundCheck(
  samples: BackgroundSample[],
  step: number,
  rowHeights: number[],
  overlayOpacity: number,
  duration = Infinity
): CheckItem {
  if (samples.length === 0) return { id: 'background', state: 'unsure' };
  const missing = samples
    .filter(s => s.expected !== 'none' && isFallback(s.patch, rowHeights, overlayOpacity))
    .map(s => s.time);
  const stillTimes: number[] = [];
  samples.forEach((sample, i) => {
    const previous = samples[i - 1];
    if (!previous || sample.expected !== 'video' || previous.expected !== 'video') return;
    if (missing.includes(sample.time)) return;
    if (patchChange(sample.patch, previous.patch) < STILL_BELOW) stillTimes.push(previous.time);
  });
  const still = spans(stillTimes, step, 'still').filter(span => span.end - span.start >= STILL_FOR);
  const found = [...spans(missing, step, 'missing'), ...still]
    .map(span => ({ ...span, end: Math.min(span.end, duration) }))
    .sort((a, b) => a.start - b.start);
  return { id: 'background', state: found.length ? 'problem' : 'ok', spans: found };
}
