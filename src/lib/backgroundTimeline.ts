import { BACKGROUND_VIDEOS } from './quranData';

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
  bgMode?: 'single' | 'per-ayah' | 'cycle' | 'shuffle';
  bgCycleSeconds?: number;
}

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
  if (config.bgType !== 'video') return [];
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
  const playlist = backgroundPlaylist(config);
  const count = playlist.length;
  if (count === 0) return null;
  if (count === 1) return { url: playlist[0], start: 0, key: 'only' };

  const at = Math.max(0, time);
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
  if (url.startsWith('blob:')) return 'Uploaded clip';
  try {
    const file = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (file) return decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, '');
  } catch {
    // Not a parseable url -- fall through to the generic name.
  }
  return 'Background';
}
