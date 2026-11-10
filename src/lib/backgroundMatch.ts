/**
 * A background chosen for a matched clip: one video, about as long as the clip.
 *
 * A match gives the clip a look (a style preset, at random) and a background
 * long enough to play once under it, so one video plays rather than a short
 * one looping, without a two-minute video picked for thirty seconds. Of the
 * videos at least as long as the clip, the `NEAREST` closest in length, and one
 * of them at random; none long enough, the longest there is, looped.
 *
 * The built-in backgrounds are all short (6.5 to 40.8 s), so they come from a
 * Pexels search (`/api/background/match`), which can ask for a least length;
 * the built-ins are what is left when Pexels cannot be asked.
 */

import { BACKGROUND_VIDEOS } from './quranData';

export interface BackgroundCandidate {
  url: string;
  /** Its length in whole seconds, as Pexels gives it. */
  seconds: number;
  /** Who made it, for the studio to say. */
  credit?: string;
}

/** How many of the closest in length the one is chosen from. */
export const NEAREST = 4;

/**
 * Asked of a background beyond the clip's own length. Pexels rounds its
 * lengths, and the loop leaves out up to 1.5 s of black at either end
 * (`clipLoop`), so a video given as exactly the clip's length can still loop.
 */
export const LENGTH_MARGIN_SEC = 2;

/**
 * What is searched for: calm footage, of places and skies rather than people.
 * A few are asked each time, so a run of matches does not draw from one theme.
 */
export const BACKGROUND_QUERIES = [
  'clouds', 'night sky', 'stars', 'ocean waves', 'mountains', 'desert', 'forest', 'waterfall', 'sunset', 'mosque'
];

/** The least length to ask for: the clip and the margin, in Pexels' whole seconds. */
export function leastLength(clipSeconds: number): number {
  return Math.ceil(Math.max(0, clipSeconds) + LENGTH_MARGIN_SEC);
}

/** Pexels' orientation for a frame shape. */
export function searchOrientation(aspectRatio: string): 'portrait' | 'landscape' | 'square' {
  if (aspectRatio === '16:9') return 'landscape';
  if (aspectRatio === '1:1') return 'square';
  return 'portrait';
}

/**
 * The background for a clip of `clipSeconds`: one of the `NEAREST` long enough
 * that are closest to it in length, or, none long enough, the longest. Null
 * for no candidates at all.
 */
export function chooseBackground(
  candidates: BackgroundCandidate[], clipSeconds: number, random: () => number = Math.random
): BackgroundCandidate | null {
  const unique = [...new Map(candidates.filter(c => c.url && c.seconds > 0).map(c => [c.url, c])).values()];
  const need = leastLength(clipSeconds);
  const longEnough = unique.filter(c => c.seconds >= need).sort((a, b) => a.seconds - b.seconds);
  const pool = longEnough.length ? longEnough.slice(0, NEAREST) : unique.sort((a, b) => b.seconds - a.seconds).slice(0, 1);
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : null;
}

/** `count` of `items` at random, each at most once. */
export function sample<T>(items: readonly T[], count: number, random: () => number = Math.random): T[] {
  const left = [...items];
  const out: T[] = [];
  while (out.length < count && left.length) out.push(left.splice(Math.floor(random() * left.length), 1)[0]);
  return out;
}

/** The built-in backgrounds' lengths, measured with ffprobe on 2026-11-09: what is chosen from when Pexels cannot be asked. */
const BUILT_IN_SECONDS: Record<string, number> = {
  'mosque-moon': 15.2, 'starry-sky': 10.4, 'aerial-mosque': 18.9, 'milky-way': 10.0, 'clouds-night': 40.8,
  'prophet-mosque': 10.7, 'minaret-moonlit': 11.0, 'aerial-mosque-night': 17.2, 'urban-mosque-night': 12.1,
  'kaaba-pilgrims': 6.5, 'kaaba-daylight': 13.2,
};

export function builtInCandidates(): BackgroundCandidate[] {
  return BACKGROUND_VIDEOS.filter(video => BUILT_IN_SECONDS[video.id]).map(video => ({ url: video.url, seconds: BUILT_IN_SECONDS[video.id] }));
}
