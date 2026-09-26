/**
 * Reads a finished render in the browser and measures it for `renderCheck`.
 *
 * Run when asked, not when the render ends: the moment an export finishes is
 * when the muxer's buffers and the file are all still in memory, and decoding
 * a large file on top of them is how the result screen once crashed (see the
 * `preload="none"` note in `GpuExportModal`).
 */

import { computePeaks, decodeAudioFile } from './audioTrim';
import { loadWaveform } from './waveform';
import { loadElement, seekTo } from './videoFrames';
import { mediaKind, type BackgroundSegment } from './backgroundTimeline';
import { frameLayout } from './frameLayout';
import {
  lengthCheck, edgeCheck, backgroundCheck,
  type CheckItem, type BackgroundSample, type Patch
} from './renderCheck';

export interface RenderCheckInput {
  /** The trim, on the recording's clock. */
  range: { start: number; end: number };
  fps: number;
  /** The recording the render's audio came from, and its length. */
  sourceUrl: string;
  sourceDuration: number;
  /** The background lane, on the recording's clock. */
  lane: BackgroundSegment[];
  layout: string | undefined;
  overlayOpacity: number;
}

/** How many rows and columns the sampled strip is cut into. */
const ROWS = 6;
const COLS = 4;
/** At most this many background samples, however long the clip. */
const MAX_SAMPLES = 90;

/**
 * A recorded WebM reports its duration as Infinity until the element has been
 * asked for a time past the end -- the recorder never wrote one.
 */
async function knownDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return video.duration;
  await new Promise<void>(resolve => {
    const done = () => { video.removeEventListener('durationchange', done); resolve(); };
    video.addEventListener('durationchange', done);
    video.currentTime = 1e9;
    setTimeout(done, 3000);
  });
  return video.duration;
}

/**
 * The strip beside the text box: never under the card, the badge, the
 * waveform or the watermark in any layout, so what it shows is the background.
 */
function sampleStrip(video: HTMLVideoElement, canvas: HTMLCanvasElement, layout: string | undefined): Patch {
  const { videoWidth: width, videoHeight: height } = video;
  const box = frameLayout(layout, width, height).text;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  canvas.width = COLS;
  canvas.height = ROWS;
  ctx.drawImage(video, 0, box.y, Math.max(1, box.x * 0.75), box.height, 0, 0, COLS, ROWS);
  // Cell by cell, not averaged across the row: slow footage -- a night sky,
  // clouds -- moves by a level or two, and averaging hid it as a freeze.
  const { data } = ctx.getImageData(0, 0, COLS, ROWS);
  return Array.from({ length: ROWS * COLS }, (_, cell) => [0, 1, 2].map(channel => data[cell * 4 + channel]));
}

/** The height, as a fraction of the frame, of each sampled cell's centre. */
function rowHeights(layout: string | undefined): number[] {
  const box = frameLayout(layout, 1, 1).text;
  return Array.from({ length: ROWS * COLS }, (_, cell) => box.y + ((Math.floor(cell / COLS) + 0.5) / ROWS) * box.height);
}

function expectedAt(lane: BackgroundSegment[], time: number): BackgroundSample['expected'] {
  for (let i = lane.length - 1; i >= 0; i--) {
    if (time >= lane[i].start && time < lane[i].end) return mediaKind(lane[i].url);
  }
  return 'none';
}

async function checkBackground(video: HTMLVideoElement, duration: number, input: RenderCheckInput): Promise<CheckItem> {
  if (!video.videoWidth || !Number.isFinite(duration)) return { id: 'background', state: 'unsure' };
  const step = Math.max(1, duration / MAX_SAMPLES);
  const canvas = document.createElement('canvas');
  const times = Array.from({ length: Math.ceil((duration - 0.05) / step) }, (_, i) => i * step);
  // One element, so one seek at a time: each sample waits for the one before.
  const samples = await times.reduce<Promise<BackgroundSample[]>>(
    (earlier, time) => earlier.then(async done => {
      await seekTo(video, time);
      return [...done, {
        time,
        patch: sampleStrip(video, canvas, input.layout),
        expected: expectedAt(input.lane, input.range.start + time),
      }];
    }),
    Promise.resolve([])
  );
  return backgroundCheck(samples, step, rowHeights(input.layout), input.overlayOpacity, duration);
}

async function checkAudio(blob: Blob, input: RenderCheckInput): Promise<{ items: CheckItem[]; seconds: number }> {
  const [source, rendered] = await Promise.all([
    loadWaveform(input.sourceUrl),
    decodeAudioFile(blob).catch(() => null),
  ]);
  if (!rendered) return { items: [{ id: 'start', state: 'unsure' }, { id: 'end', state: 'unsure' }], seconds: NaN };
  if (!source || !(input.sourceDuration > 0)) {
    return { items: [{ id: 'start', state: 'unsure' }, { id: 'end', state: 'unsure' }], seconds: rendered.duration };
  }
  // The render's envelope at the recording's rate, so the two line up bucket for bucket.
  const rate = source.length / input.sourceDuration;
  const peaks = computePeaks(rendered, Math.max(1, Math.round(rendered.duration * rate)));
  return {
    items: [
      edgeCheck('start', source, peaks, rate, input.range),
      edgeCheck('end', source, peaks, rate, input.range),
    ],
    seconds: rendered.duration,
  };
}

export async function checkRender(blobUrl: string, blob: Blob, input: RenderCheckInput): Promise<CheckItem[]> {
  const audio = await checkAudio(blob, input);
  const video = await loadElement(blobUrl);
  try {
    const duration = video ? await knownDuration(video) : NaN;
    const length = lengthCheck(
      Number.isFinite(duration) ? duration : audio.seconds,
      input.range.end - input.range.start,
      input.fps
    );
    const background = video ? await checkBackground(video, duration, input) : { id: 'background' as const, state: 'unsure' as const };
    return [length, ...audio.items, background];
  } finally {
    video?.removeAttribute('src');
    video?.load();
  }
}
