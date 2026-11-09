/**
 * Several clips cut from one uploaded recording.
 *
 * A long upload -- a night's recitation, a lesson -- is matched once, and the
 * clips are windows on it: a start and an end on the recording's own clock,
 * the same clock its captions are on. Nothing is re-cut. A caption fixed while
 * one clip is open is fixed in every clip that holds it, and clips may overlap.
 * The studio plays and exports a clip the way it plays a built-in reciter's
 * passage inside its chapter file (`clipWindow`, `exportRangeFor`).
 *
 * Every clip has the look being edited unless it is given its own. A clip
 * with its own look keeps only what differs from the shared one, so a change
 * to the shared look still reaches whatever the clip did not change.
 *
 * Pure state here, so the rules can be tested without a studio.
 */

import { timelinePassage } from './projectPayload';

export interface RecordingClip {
  id: string;
  /** Seconds on the recording's clock, as its captions are. */
  start: number;
  end: number;
  /** What this clip changes from the shared look, or null when it has the shared look. */
  style: Record<string, unknown> | null;
}

/** Shorter than this is a slip of the pointer, not a clip. */
export const MIN_CLIP_SEC = 1;
/** The most of a pause before an ayah a clip by ayahs opens with, and after one it closes with. */
export const AYAH_LEAD_SEC = 0.5;
/** More than any recording is cut into; a bound on what a saved project can carry. */
export const MAX_CLIPS = 100;

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

let counter = 0;
const newId = () => {
  counter += 1;
  return `clip-${Date.now().toString(36)}-${counter}`;
};

/** A clip for this stretch of the recording, inside it; null when there is no clip there. */
export function newClip(start: number, end: number, duration: number): RecordingClip | null {
  const from = ms(Math.max(0, Math.min(start, end)));
  const to = ms(duration > 0 ? Math.min(duration, Math.max(start, end)) : Math.max(start, end));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < MIN_CLIP_SEC) return null;
  return { id: newId(), start: from, end: to, style: null };
}

/** Adds a clip, unless one already covers exactly that stretch -- two clicks are one intention. */
export function addClip(clips: RecordingClip[], clip: RecordingClip | null): RecordingClip[] {
  if (!clip || clips.length >= MAX_CLIPS) return clips;
  const same = clips.some(other => Math.abs(other.start - clip.start) < 0.01 && Math.abs(other.end - clip.end) < 0.01);
  return same ? clips : [...clips, clip];
}

export function removeClip(clips: RecordingClip[], id: string): RecordingClip[] {
  return clips.filter(clip => clip.id !== id);
}

/** The clip with a new window, kept inside the recording and no shorter than a clip can be. */
export function moveClip(clips: RecordingClip[], id: string, start: number, end: number, duration: number): RecordingClip[] {
  const moved = newClip(start, end, duration);
  if (!moved) return clips;
  return clips.map(clip => (clip.id === id ? { ...clip, start: moved.start, end: moved.end } : clip));
}

/** In the order they play in the recording, which is the order they are listed and numbered in. */
export function inPlayOrder(clips: RecordingClip[]): RecordingClip[] {
  return [...clips].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The captions a clip holds: any that is heard inside it, on the recording's clock still. */
export function clipVerses<V extends { startTime: number; endTime: number }>(verses: V[], clip: { start: number; end: number }): V[] {
  return verses.filter(verse => verse.endTime > clip.start && verse.startTime < clip.end);
}

/**
 * The window for the captions `first` to `last` (indices into `verses`):
 * from the pause before the first to the pause after the last, so a clip by
 * ayahs opens on the reciter's breath rather than inside his first word. Half
 * of each pause, and no more than `AYAH_LEAD_SEC` of it.
 */
export function ayahWindow(
  verses: { startTime: number; endTime: number }[], first: number, last: number, duration: number
): { start: number; end: number } | null {
  const [from, to] = first <= last ? [first, last] : [last, first];
  const opening = verses[from];
  const closing = verses[to];
  if (!opening || !closing) return null;
  const before = from > 0 ? verses[from - 1].endTime : 0;
  const after = to < verses.length - 1 ? verses[to + 1].startTime : duration > 0 ? duration : closing.endTime + AYAH_LEAD_SEC;
  const start = Math.max(before + Math.max(0, opening.startTime - before) / 2, opening.startTime - AYAH_LEAD_SEC, 0);
  const end = Math.min(closing.endTime + Math.max(0, after - closing.endTime) / 2, closing.endTime + AYAH_LEAD_SEC);
  return { start: ms(Math.min(start, opening.startTime)), end: ms(Math.max(end, closing.endTime)) };
}

/** The ayahs a clip holds, as `2:1–5`, or its times when it holds none. */
export function clipLabel(verses: { verseKey?: string; startTime: number; endTime: number }[], clip: { start: number; end: number }): string {
  const held = clipVerses(verses, clip);
  const passage = timelinePassage(held, { surahNumber: 0, start: 0, end: 0 });
  if (!passage.surahNumber) return '';
  return passage.start === passage.end
    ? `${passage.surahNumber}:${passage.start}`
    : `${passage.surahNumber}:${passage.start}–${passage.end}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What `config` changes from `base`: the clip's own look, as it is kept. */
export function styleDiff(config: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(config)) if (!same(config[key], base[key])) diff[key] = config[key];
  return diff;
}

/** The look a clip is drawn with: the shared one, with whatever the clip changes. */
export function clipStyle<C extends object>(base: C, clip: RecordingClip | null | undefined): C {
  return clip?.style ? { ...base, ...(clip.style as Partial<C>) } : base;
}

/**
 * The shared look and every clip's own, as they stand: the open clip's, when
 * it has a look of its own, is what the config it is drawn with changes from
 * the shared look kept aside (`shared`). Otherwise the config is the shared look.
 */
export function settleLooks<C extends object>(
  config: C, clips: RecordingClip[], activeId: string | null, shared: C | null
): { base: C; clips: RecordingClip[] } {
  const open = clips.find(clip => clip.id === activeId);
  if (!open?.style || !shared) return { base: config, clips };
  const own = styleDiff(config as Record<string, unknown>, shared as Record<string, unknown>);
  return { base: shared, clips: clips.map(clip => (clip.id === open.id ? { ...clip, style: own } : clip)) };
}

/**
 * The open clip given a look of its own, starting from the shared one, or the
 * shared one back: its clips, the shared look to keep aside while it has its
 * own, and the config to draw it with. Null when there is nothing to change.
 */
export function switchOwnLook<C extends object>(
  on: boolean, config: C, clips: RecordingClip[], activeId: string | null, shared: C | null
): { clips: RecordingClip[]; shared: C | null; config: C } | null {
  const open = clips.find(clip => clip.id === activeId);
  if (!open || on === !!open.style) return null;
  const marked = clips.map(clip => (clip.id === open.id ? { ...clip, style: on ? {} : null } : clip));
  return on ? { clips: marked, shared: config, config } : { clips: marked, shared: null, config: shared ?? config };
}

/**
 * Clips as saved, made safe: what the studio stores and what the server
 * accepts. Anything that is not a clip inside the recording is dropped.
 */
export function normalizeClips(value: unknown): RecordingClip[] {
  if (!Array.isArray(value)) return [];
  const clips: RecordingClip[] = [];
  for (const raw of value.slice(0, MAX_CLIPS)) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, start, end, style } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof start !== 'number' || typeof end !== 'number') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < MIN_CLIP_SEC) continue;
    const ownStyle = style && typeof style === 'object' && !Array.isArray(style) ? (style as Record<string, unknown>) : null;
    clips.push({ id: id.slice(0, 64), start: ms(start), end: ms(end), style: ownStyle });
  }
  return clips;
}
