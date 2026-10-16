/**
 * The audio an `AudioEdit` makes, rendered by ffmpeg. Server only.
 *
 * One pass, in this order: the cuts, each side of a join faded over 10ms so it
 * never clicks and laid end to end so the result is exactly what was kept; the
 * clean-up of a recording of one's own; the speed-up, by Rubber Band, which
 * stretches time without moving pitch or formants, so the reciter keeps his
 * voice (ffmpeg's atempo where it was built without it); and the loudness,
 * measured first and then applied as one gain, so nothing pumps.
 *
 * FLAC out: lossless, so the edited clock is the samples and the captions,
 * moved by `audioEdit` arithmetic, land where the sound is. A re-encode to
 * MP3 or AAC adds encoder delay that players trim differently.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CUT_FADE_SEC, LOOP_TAIL_SEC, keptSpans, type AudioEdit } from './audioEdit';

const execFileAsync = promisify(execFile);

/** The loudness streaming platforms normalise speech to, and the peak kept under. */
const LOUDNESS = { I: -16, TP: -1.5, LRA: 11 };
/** Hum below the voice, then broadband room and fan noise, tracked as it changes. */
const DENOISE = 'highpass=f=60,afftdn=nr=12:nf=-50:tn=1';
const RATE = 44100;
/**
 * A loop-friendly ending: the first moment faded in and the last faded out,
 * each too short to touch a word -- a passage starts and ends in its own
 * silence -- then the tail of silence. The fade out runs on the reversed
 * stream, which needs no length up front.
 */
const LOOP_ENDING = `afade=t=in:d=0.1,areverse,afade=t=in:d=0.15,areverse,apad=pad_dur=${LOOP_TAIL_SEC}`;
const RENDER_TIMEOUT_MS = 10 * 60_000;

export interface Loudness {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

const sec = (value: number) => value.toFixed(4);

/** Kept for less than this at the recording's end, nothing is: a cut to the end, measured a frame short. */
const MIN_KEPT_SEC = 0.02;

/**
 * The filter graph for `edit`, from input 0's audio to `[out]`. With
 * `measured`, the loudness pass applies; without it, a loudness edit measures.
 * `duration` is the recording's length as the studio knows it: what is kept
 * after the last cut runs to the file's own end, whatever that is.
 */
export function editGraph(edit: AudioEdit, duration: number, options: { rubberband: boolean; measured?: Loudness }): string {
  const chains = edit.cuts.length ? cutChains(edit, duration) : [];
  const label = edit.cuts.length ? 'cut' : '0:a';
  const after: string[] = [];
  if (edit.denoise) after.push(DENOISE);
  if (edit.tempo !== 1) after.push(options.rubberband ? `rubberband=tempo=${edit.tempo}:pitchq=quality` : `atempo=${edit.tempo}`);
  if (edit.loudness) {
    const target = `I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
    const m = options.measured;
    after.push(m
      ? `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
      : `loudnorm=${target}:print_format=json`);
  }
  if (edit.loop) after.push(LOOP_ENDING);
  chains.push(`[${label}]${after.length ? after.join(',') : 'anull'}[out]`);
  return chains.join(';');
}

/** What is kept between the cuts, each faded at its joins, laid end to end as `[cut]`. */
function cutChains(edit: AudioEdit, duration: number): string[] {
  const kept = keptSpans(edit.cuts, Infinity)
    .filter(span => Number.isFinite(span.end) || span.start < duration - MIN_KEPT_SEC);
  const chains = kept.map((span, i) => {
    const steps = [`atrim=start=${sec(span.start)}${Number.isFinite(span.end) ? `:end=${sec(span.end)}` : ''}`, 'asetpts=PTS-STARTPTS'];
    // Only at a join: the recording's own first and last moments are not one.
    if (span.start > 0) steps.push(`afade=t=in:d=${CUT_FADE_SEC}`);
    if (Number.isFinite(span.end)) steps.push(`afade=t=out:st=${sec(Math.max(0, span.end - span.start - CUT_FADE_SEC))}:d=${CUT_FADE_SEC}`);
    return `[0:a]${steps.join(',')}[k${i}]`;
  });
  return [...chains, `${kept.map((_, i) => `[k${i}]`).join('')}concat=n=${kept.length}:v=0:a=1[cut]`];
}

/** The loudness pass's measurement, read from what it printed. */
export function measuredLoudness(stderr: string): Loudness | null {
  const match = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const keys: (keyof Loudness)[] = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
  const values = parsed && typeof parsed === 'object' ? keys.map(key => String((parsed as Record<string, unknown>)[key])) : [];
  // Silence measures as -inf, which no gain can bring to anything.
  if (values.length !== keys.length || !values.every(value => Number.isFinite(Number(value)))) return null;
  const [input_i, input_tp, input_lra, input_thresh, target_offset] = values;
  return { input_i, input_tp, input_lra, input_thresh, target_offset };
}

let rubberbandBuilt: Promise<boolean> | null = null;
function hasRubberband(ffmpeg: string): Promise<boolean> {
  rubberbandBuilt ??= execFileAsync(ffmpeg, ['-hide_banner', '-filters'], { timeout: 10_000 })
    .then(({ stdout }) => /\brubberband\b/.test(stdout), () => false);
  return rubberbandBuilt;
}

const BASE = ['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-y'];

/** Renders `input` with `edit` applied to `output`, as 16-bit FLAC. */
export async function renderEdit(ffmpeg: string, input: string, edit: AudioEdit, duration: number, output: string): Promise<void> {
  const rubberband = await hasRubberband(ffmpeg);
  let measured: Loudness | undefined;
  if (edit.loudness) {
    const { stderr } = await execFileAsync(ffmpeg, [...BASE, '-i', input, '-filter_complex', editGraph(edit, duration, { rubberband }), '-map', '[out]', '-f', 'null', '-'],
      { timeout: RENDER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    measured = measuredLoudness(stderr) ?? undefined;
  }
  // Silence cannot be measured, so it is left at its level.
  const applied = edit.loudness && !measured ? { ...edit, loudness: false } : edit;
  await execFileAsync(ffmpeg, [...BASE, '-i', input, '-filter_complex', editGraph(applied, duration, { rubberband, measured }), '-map', '[out]',
    '-ar', String(RATE), '-sample_fmt', 's16', '-c:a', 'flac', output], { timeout: RENDER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
}
