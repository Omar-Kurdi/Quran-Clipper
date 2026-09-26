/**
 * What is worth saying before a render starts.
 *
 * Two things render silently and look like faults afterwards. A gap in a
 * hand-cut background lane is allowed and paints the plain gradient, in the
 * preview and the export alike. And a background the browser cannot decode
 * frame by frame either renders by seeking -- slowly -- or, when it cannot be
 * read at all, as the gradient too. The lane and `openBackgroundClip` already
 * know both; this puts them in front of the person about to press Render.
 */

import { mediaKind, type BackgroundSegment } from './backgroundTimeline';
import { openBackgroundClip } from './videoFrames';

/** How a background will be read by the export. */
export type BackgroundRead = 'decoder' | 'seeking' | 'image' | 'unreadable';

export type ExportWarning =
  | { kind: 'gap'; start: number; end: number }
  | { kind: 'seeking'; url: string }
  | { kind: 'unreadable'; url: string };

/** Shorter than this is a rounding seam between two blocks, not a gap anyone would see. */
const SEAM = 0.1;

/**
 * The stretches of `[start, end)` that no block covers, on the export's own
 * clock (0 is the first frame of the render).
 */
export function laneGaps(segments: BackgroundSegment[], start: number, end: number): { start: number; end: number }[] {
  const covered = segments
    .map(seg => ({ start: Math.max(seg.start, start), end: Math.min(seg.end, end) }))
    .filter(seg => seg.end > seg.start)
    .sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let reached = start;
  for (const seg of covered) {
    if (seg.start - reached >= SEAM) gaps.push({ start: reached - start, end: seg.start - start });
    reached = Math.max(reached, seg.end);
  }
  if (end - reached >= SEAM) gaps.push({ start: reached - start, end: end - start });
  return gaps;
}

/** The backgrounds a render of `[start, end)` will draw, once each. */
export function backgroundsIn(segments: BackgroundSegment[], start: number, end: number): string[] {
  return Array.from(new Set(
    segments.filter(seg => seg.end > start && seg.start < end && seg.url).map(seg => seg.url)
  ));
}

/**
 * Everything to say, in the order it is worth reading: gaps first, since they
 * are certain, then backgrounds that will not read well.
 *
 * `offline` is whether the render is encoded frame by frame. A recorded render
 * plays the background as the preview does, so how a clip would be decoded
 * does not apply to it -- only whether it can be read at all.
 */
export function exportWarnings(
  input: {
    /** Only a hand-cut lane can have gaps; the automatic modes cover the clip. */
    handCut: boolean;
    segments: BackgroundSegment[];
    start: number;
    end: number;
    reads: Record<string, BackgroundRead>;
    offline: boolean;
  }
): ExportWarning[] {
  const gaps: ExportWarning[] = input.handCut
    ? laneGaps(input.segments, input.start, input.end).map(gap => ({ kind: 'gap' as const, ...gap }))
    : [];
  const reading = backgroundsIn(input.segments, input.start, input.end).flatMap((url): ExportWarning[] => {
    const read = input.reads[url];
    if (read === 'unreadable') return [{ kind: 'unreadable', url }];
    if (read === 'seeking' && input.offline) return [{ kind: 'seeking', url }];
    return [];
  });
  return [...gaps, ...reading];
}

const reads = new Map<string, Promise<BackgroundRead>>();

function probeImage(url: string): Promise<BackgroundRead> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image.naturalWidth > 0 ? 'image' : 'unreadable');
    image.onerror = () => resolve('unreadable');
    image.src = url;
  });
}

/**
 * Opens a clip the way the export will and reads its first frame. Remembered
 * per url for the session: it fetches the whole file, and the answer does not
 * change between two openings of the export dialog.
 */
async function probeVideo(url: string): Promise<BackgroundRead> {
  const clip = await openBackgroundClip(url).catch(() => null);
  if (!clip) return 'unreadable';
  try {
    const frame = await clip.frameAt(0).catch(() => null);
    return frame ? clip.readsBy : 'unreadable';
  } finally {
    clip.close();
  }
}

export function probeBackground(url: string): Promise<BackgroundRead> {
  let known = reads.get(url);
  if (!known) {
    known = mediaKind(url) === 'image' ? probeImage(url) : probeVideo(url);
    reads.set(url, known);
  }
  return known;
}
