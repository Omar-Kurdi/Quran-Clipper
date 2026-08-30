import { BACKGROUND_VIDEOS } from './quranData';
import { MIN_SEGMENT } from './verseEdits';

/**
 * Where each background sits in time.
 *
 * The canvas and the timeline used to answer "which background is showing?"
 * independently -- the canvas from an inline `switch`, the timeline not at all,
 * which is why the strip below the preview showed ayah blocks over a background
 * that changed invisibly underneath them. Both now read this one module, so a
 * block drawn on the timeline is the clip the export will actually contain.
 */
export interface BackgroundSegment {
  url: string;
  start: number;
  end: number;
}

/** The subset of the canvas config that decides backgrounds. */
export interface BackgroundConfig {
  bgType: string;
  bgUrl: string;
  bgUrls?: string[];
  bgMode?: BackgroundMode;
  bgCycleSeconds?: number;
  /**
   * Hand-placed backgrounds, authoritative in `custom` mode.
   *
   * The other four modes *derive* where a clip sits from the ayah timings or a
   * timer, which is why a block could not simply be dragged: there was nothing
   * to drag it in. Dragging one bakes the derived layout into this list and
   * switches to `custom`; picking an automatic mode again clears it.
   */
  bgSegments?: BackgroundSegment[];
}

export type BackgroundMode = 'single' | 'per-ayah' | 'cycle' | 'shuffle' | 'custom';

/** What a background actually is: footage, or a still. */
export type MediaKind = 'video' | 'image';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

/**
 * Kinds we were told rather than guessed.
 *
 * An upload becomes a `blob:` url with no extension, and plenty of image CDNs
 * serve stills from extensionless paths -- so the kind has to be recorded where
 * it is actually known (the `File.type` at upload, a probe at paste time)
 * instead of re-derived from a string later. Module-level and deliberately not
 * persisted: `blob:` urls die with the page anyway, and a saved project's
 * http(s) urls carry enough in their path to be read back below.
 */
const knownKinds = new Map<string, MediaKind>();

export function rememberMediaKind(url: string, kind: MediaKind): void {
  if (url) knownKinds.set(url, kind);
}

/** Footage unless we know or can see otherwise -- video is what the studio is mostly given. */
export function mediaKind(url: string): MediaKind {
  return knownKinds.get(url) ?? (IMAGE_EXTENSIONS.test(url) ? 'image' : 'video');
}

/** The automatic layouts, and the only values a saved project may name besides `custom`. */
export const BACKGROUND_MODES: BackgroundMode[] = ['single', 'per-ayah', 'cycle', 'shuffle', 'custom'];

/**
 * Backgrounds in play, in order -- duplicates included.
 *
 * `bgUrl` remains the single-background case so existing projects, the saved
 * schema and the API payload keep working untouched; `bgUrls` only takes over
 * once a multi mode is selected and something is actually in the list. The same
 * clip may appear more than once: "this one at the start and again at the end"
 * is an ordinary thing to want, and the list is a sequence, not a set.
 */
export function backgroundPlaylist(config: BackgroundConfig): string[] {
  // Stills belong here too. This used to be `!== 'video'`, so choosing an image
  // emptied the playlist, left the canvas with nothing to draw, and fell through
  // to the gradient -- an upload that appeared to do nothing at all. Only the
  // two url-less types have genuinely no media to play.
  if (config.bgType === 'gradient' || config.bgType === 'color') return [];
  if (config.bgMode === 'custom') {
    // Order carries no meaning here -- the lane's times do -- so this is just
    // the set of clips the pool has to keep warm, deduplicated.
    return Array.from(new Set((config.bgSegments || []).map(s => s.url).filter(Boolean)));
  }
  const many = (config.bgUrls || []).filter(Boolean);
  if (config.bgMode && config.bgMode !== 'single' && many.length > 0) return many;
  return config.bgUrl ? [config.bgUrl] : [];
}

/** Seconds each background holds in `cycle` mode, floored at 1. */
const holdOf = (config: BackgroundConfig) => Math.max(1, config.bgCycleSeconds || 5);

/**
 * Seeded from the segment index, never `Math.random()`: the value has to be
 * identical on every frame and identical again during export, or the background
 * would flicker and the render would not match the preview.
 */
const shuffleAt = (index: number, count: number) =>
  (Math.imul(index + 1, 2654435761) >>> 0) % count;

/** Last ayah to have begun at `time`; the first ayah before any has. */
function verseIndexAt(verseStarts: number[], time: number): number {
  let index = 0;
  for (let i = verseStarts.length - 1; i >= 0; i--) {
    if (time >= verseStarts[i]) { index = i; break; }
  }
  return index;
}

/**
 * The background showing at `time`, and when it came on screen.
 *
 * `start` is what lets a clip be played from its own beginning rather than from
 * wherever a free-running loop happened to be, and `key` identifies the
 * occurrence -- so the same url appearing twice in a sequence is two segments,
 * not one.
 */
export function backgroundAt(
  config: BackgroundConfig,
  verseStarts: number[],
  time: number
): { url: string; start: number; key: string } | null {
  const at = Math.max(0, time);

  if (config.bgMode === 'custom') {
    const segments = config.bgSegments || [];
    // Last match wins, and a time in no segment is genuinely no background --
    // a hand-cut lane is allowed to have gaps, and a gap shows the gradient.
    for (let i = segments.length - 1; i >= 0; i--) {
      if (at >= segments[i].start && at < segments[i].end) {
        return { url: segments[i].url, start: segments[i].start, key: `s${i}` };
      }
    }
    return null;
  }

  const playlist = backgroundPlaylist(config);
  const count = playlist.length;
  if (count === 0) return null;
  if (count === 1) return { url: playlist[0], start: 0, key: 'only' };

  switch (config.bgMode) {
    case 'per-ayah':
    case 'shuffle': {
      const i = verseIndexAt(verseStarts, at);
      const pick = config.bgMode === 'shuffle' ? shuffleAt(i, count) : i % count;
      return { url: playlist[pick], start: i === 0 ? 0 : verseStarts[i] ?? 0, key: `v${i}` };
    }
    case 'cycle': {
      const hold = holdOf(config);
      const k = Math.floor(at / hold);
      return { url: playlist[k % count], start: k * hold, key: `c${k}` };
    }
    default:
      return { url: playlist[0], start: 0, key: 'only' };
  }
}

/**
 * Every background occurrence across a clip of `duration` seconds.
 *
 * Deliberately unmerged: two adjacent occurrences of the same clip stay two
 * blocks, so the lane lines up one-for-one with the ayah blocks above it.
 */
export function backgroundSegments(
  config: BackgroundConfig,
  verseStarts: number[],
  duration: number
): BackgroundSegment[] {
  if (config.bgMode === 'custom') return config.bgSegments || [];

  const playlist = backgroundPlaylist(config);
  const count = playlist.length;
  if (count === 0 || !(duration > 0)) return [];
  if (count === 1) return [{ url: playlist[0], start: 0, end: duration }];

  const out: BackgroundSegment[] = [];
  switch (config.bgMode) {
    case 'per-ayah':
    case 'shuffle': {
      for (let i = 0; i < verseStarts.length; i++) {
        const start = i === 0 ? 0 : verseStarts[i];
        const end = i + 1 < verseStarts.length ? verseStarts[i + 1] : duration;
        if (!(end > start)) continue;
        const pick = config.bgMode === 'shuffle' ? shuffleAt(i, count) : i % count;
        out.push({ url: playlist[pick], start, end: Math.min(end, duration) });
      }
      break;
    }
    case 'cycle': {
      const hold = holdOf(config);
      for (let k = 0; k * hold < duration; k++) {
        out.push({ url: playlist[k % count], start: k * hold, end: Math.min((k + 1) * hold, duration) });
      }
      break;
    }
    default:
      out.push({ url: playlist[0], start: 0, end: duration });
  }
  return out;
}

/** A short human name for a background, for timeline blocks and the sequence list. */
export function backgroundLabel(url: string): string {
  const preset = BACKGROUND_VIDEOS.find(bg => bg.url === url);
  if (preset) return preset.title;
  const kind = mediaKind(url);
  if (url.startsWith('blob:')) return kind === 'image' ? 'Uploaded image' : 'Uploaded clip';
  // A data: url's "path" is the file itself -- naming it after that would put a
  // kilobyte of base64 in the list.
  if (url.startsWith('data:')) return kind === 'image' ? 'Pasted image' : 'Pasted clip';
  try {
    const file = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (file) return decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, '');
  } catch {
    // Not a parseable url -- fall through to the generic name.
  }
  return 'Background';
}

// ---------------------------------------------------------------------------
// Editing a hand-cut lane
//
// Every operation below returns a new list sorted by start, with no two blocks
// overlapping. Gaps are allowed -- an empty stretch is a deliberate "nothing
// here", and the canvas draws its gradient through it -- but overlaps are not,
// because two clips claiming the same instant has no honest answer.
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The room a block has, given the blocks either side of it. */
function neighbours(segments: BackgroundSegment[], index: number, duration: number) {
  return {
    floor: index > 0 ? segments[index - 1].end : 0,
    ceiling: index + 1 < segments.length ? segments[index + 1].start : Math.max(duration, 0)
  };
}

/**
 * Slides a block to a new start, keeping its length.
 *
 * The whole block is clamped as one against its neighbours rather than each
 * edge separately: clamping the edges independently lets a block quietly change
 * length when it runs into something, which reads as a bug rather than a limit.
 */
export function moveSegmentTo(
  segments: BackgroundSegment[],
  index: number,
  desiredStart: number,
  duration: number
): BackgroundSegment[] {
  const seg = segments[index];
  if (!seg) return segments;
  const { floor, ceiling } = neighbours(segments, index, duration);
  const length = seg.end - seg.start;
  const start = round2(clamp(desiredStart, floor, Math.max(floor, ceiling - length)));
  if (start === seg.start) return segments;
  return segments.map((s, i) => (i === index ? { ...s, start, end: round2(start + length) } : s));
}

/**
 * Drags one edge of a block.
 *
 * Lengthening past the clip's own running time is fine and needs nothing built:
 * background video elements loop, and each block restarts its clip at its own
 * start, so a thirty-second block of a five-second clip simply plays it six
 * times.
 */
export function resizeSegment(
  segments: BackgroundSegment[],
  index: number,
  edge: 'start' | 'end',
  value: number,
  duration: number
): BackgroundSegment[] {
  const seg = segments[index];
  if (!seg) return segments;
  const { floor, ceiling } = neighbours(segments, index, duration);
  const next = edge === 'start'
    ? { ...seg, start: round2(clamp(value, floor, seg.end - MIN_SEGMENT)) }
    : { ...seg, end: round2(clamp(value, seg.start + MIN_SEGMENT, ceiling)) };
  if (next.start === seg.start && next.end === seg.end) return segments;
  return segments.map((s, i) => (i === index ? next : s));
}

/** Drops a block, leaving a gap where it was. */
export function removeSegment(segments: BackgroundSegment[], index: number): BackgroundSegment[] {
  return segments.filter((_, i) => i !== index);
}

/**
 * Puts a clip at the end of the lane.
 *
 * With room to spare the newcomer takes it. With the lane already full it takes
 * the back half of the last block instead -- otherwise picking a background in
 * a full lane would appear to do nothing at all.
 */
export function appendSegment(
  segments: BackgroundSegment[],
  url: string,
  duration: number
): BackgroundSegment[] {
  if (!(duration > 0)) return segments;
  const last = segments[segments.length - 1];
  if (!last) return [{ url, start: 0, end: round2(duration) }];

  if (last.end <= duration - MIN_SEGMENT) {
    return [...segments, { url, start: round2(last.end), end: round2(duration) }];
  }

  const half = (last.end - last.start) / 2;
  if (half < MIN_SEGMENT) return segments;
  const split = round2(last.start + half);
  return [
    ...segments.slice(0, -1),
    { ...last, end: split },
    { url, start: split, end: round2(last.end) }
  ];
}
