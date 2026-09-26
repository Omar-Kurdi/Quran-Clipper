/**
 * Renders that run on the studio's own server, so they survive the tab.
 *
 * The frame-by-frame export already renders faster than real time, but only
 * while the tab that started it stays open: close it, or let a phone put it to
 * sleep, and the render is gone. Here the studio hands the job to the Next
 * server instead, which renders it in a headless Chromium of its own -- the
 * same page code, the same `paintFrame`, the same fonts -- and then hands the
 * picture to ffmpeg to put the recitation back in as AAC.
 *
 * Both halves are deliberate. A browser is what draws the frame: the caption
 * layout, the QPC page fonts, the blur and the video backgrounds are ~1700
 * lines of canvas code that assume a DOM, and a second implementation of them
 * on node-canvas would drift from the preview. And ffmpeg is what finishes it:
 * a headless Chromium encodes H.264 but has no AAC encoder, so on its own it
 * could only produce Opus in MP4, which far fewer players accept.
 *
 * This module is the part both sides share: the shapes of a job, and the pure
 * rules for what has to travel with it.
 */

import type { VideoCanvasConfig } from '@/components/VideoCanvas';
import type { VerseData } from '@/lib/quranData';
import type { MediaKind } from '@/lib/backgroundTimeline';

export type RenderStatus = 'queued' | 'rendering' | 'finishing' | 'done' | 'failed' | 'cancelled';

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

/** A background the studio holds only in this browser, sent along as a file. */
export interface RenderMedia {
  /** Its name among the job's inputs: `bg-0`, `bg-1`, ... */
  name: string;
  kind: MediaKind;
}

/** Everything the render page needs to draw the clip, as the studio had it. */
export interface RenderSpec {
  config: VideoCanvasConfig;
  verses: VerseData[];
  surahNameArabic: string;
  surahNameEnglish: string;
  reciterName?: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  syncBackgroundVideo: boolean;
  backgroundTimeOffset: number;
  /** Where in the recording the clip begins and ends, in seconds. */
  range: { start: number; end: number };
  plan: RenderPlan;
  fileName: string;
  /** What the export log calls it. */
  title: string;
  /** Uploaded backgrounds, in `config` as `render-input:<name>`. */
  media: RenderMedia[];
  /** The project this render was made from, saved when it was sent, for the export log to link. */
  projectId?: string;
}

/** A job as the list shows it. */
export interface RenderJob {
  id: string;
  status: RenderStatus;
  /** 0-100. */
  progress: number;
  title: string;
  fileName: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Size of the finished file. */
  bytes?: number;
  /** From the render starting to the file being ready. */
  elapsedMs?: number;
}

export const ACTIVE_STATUSES: RenderStatus[] = ['queued', 'rendering', 'finishing'];

export const isActive = (job: Pick<RenderJob, 'status'>) => ACTIVE_STATUSES.includes(job.status);

/** Job ids are made on the server; anything else is refused before it touches a path. */
export const isRenderId = (id: string) => /^r_[a-z0-9]{6,40}$/.test(id);

/** Input names are made by `withUploads`; anything else is refused before it touches a path. */
export const isInputName = (name: string) => /^(audio|bg-\d{1,3})$/.test(name);

const INPUT_PREFIX = 'render-input:';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const inRange = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/**
 * A job description, or null when it is not one.
 *
 * It arrives from a browser and is later handed to a browser, an encoder and
 * a file name, so the parts those act on are checked rather than trusted: a
 * frame size an encoder can take, a range that runs forwards, input names the
 * server made.
 */
export function parseRenderSpec(text: string): RenderSpec | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isRenderSpec(value) ? value : null;
}

/** Absent, or an id the studio mints: it ends up in a database row, so nothing else is passed on. */
const isProjectId = (value: unknown) => value === undefined || (typeof value === 'string' && /^proj_\w{1,60}$/.test(value));

const isUploadedMedia = (item: unknown) => isObject(item) && typeof item.name === 'string'
  && isInputName(item.name) && item.name !== 'audio' && (item.kind === 'video' || item.kind === 'image');

function isRenderSpec(value: unknown): value is RenderSpec {
  if (!isObject(value) || !isObject(value.config) || !Array.isArray(value.verses)) return false;
  const { plan, range, media } = value;
  return isObject(plan) && inRange(plan.width, 16, 7680) && inRange(plan.height, 16, 7680)
    && inRange(plan.fps, 1, 240) && inRange(plan.bitrate, 100_000, 200_000_000)
    && isObject(range) && inRange(range.start, 0, 86_400) && inRange(range.end, 0, 86_400)
    && Number(range.end) > Number(range.start)
    && Array.isArray(media) && media.every(isUploadedMedia)
    && typeof value.fileName === 'string' && typeof value.title === 'string' && isProjectId(value.projectId);
}

/**
 * Every background url in a config, rewritten by `map`.
 *
 * `bgUrl`, the playlist and the hand-cut lane are the three places one can
 * be, and a job that rewrote two of them would render the third as the
 * gradient fallback without saying so.
 */
export function mapBackgrounds(config: VideoCanvasConfig, map: (url: string) => string): VideoCanvasConfig {
  return {
    ...config,
    bgUrl: config.bgUrl ? map(config.bgUrl) : config.bgUrl,
    bgUrls: config.bgUrls?.map(url => (url ? map(url) : url)),
    bgSegments: config.bgSegments?.map(segment => ({ ...segment, url: segment.url ? map(segment.url) : segment.url })),
  };
}

/**
 * The config with every `blob:` background replaced by an input name, and the
 * list of what to upload under each name.
 *
 * A `blob:` url is only valid in the document that made it, so the render's
 * own browser could never load one. The same url used twice is uploaded once.
 */
export function withUploads(
  config: VideoCanvasConfig,
  kindOf: (url: string) => MediaKind
): { config: VideoCanvasConfig; uploads: { url: string; media: RenderMedia }[] } {
  const names = new Map<string, RenderMedia>();
  const rewritten = mapBackgrounds(config, url => {
    if (!url.startsWith('blob:')) return url;
    let media = names.get(url);
    if (!media) {
      media = { name: `bg-${names.size}`, kind: kindOf(url) };
      names.set(url, media);
    }
    return INPUT_PREFIX + media.name;
  });
  return { config: rewritten, uploads: Array.from(names, ([url, media]) => ({ url, media })) };
}

/** Where the render page reads one of its job's inputs. */
export const inputUrl = (id: string, key: string, name: string) =>
  `/api/render/worker?id=${id}&key=${key}&file=${name}`;

/** The config with each input name pointed at the file the server holds. */
export const withInputUrls = (config: VideoCanvasConfig, id: string, key: string) =>
  mapBackgrounds(config, url => (url.startsWith(INPUT_PREFIX) ? inputUrl(id, key, url.slice(INPUT_PREFIX.length)) : url));

/**
 * ffmpeg arguments that put the recitation under the rendered picture.
 *
 * The picture is copied, not re-encoded. The audio is the original recording
 * cut to the clip's range and encoded to AAC, rather than the Opus track the
 * headless browser wrote: that would be a second lossy pass over audio the
 * server has in its first form.
 */
export function muxArgs(input: { video: string; audio: string; start: number; end: number; output: string }): string[] {
  const seconds = (value: number) => Math.max(0, value).toFixed(3);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input.video,
    '-ss', seconds(input.start), '-t', seconds(input.end - input.start), '-i', input.audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    input.output,
  ];
}
