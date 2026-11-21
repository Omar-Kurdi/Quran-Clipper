/**
 * Stretches of a recording, and the clips cut from it.
 *
 * A clip is now a project of its own, cut from its recording
 * (`makeClipProject`). Before that, clips were windows on the recording -- a
 * start and an end on its clock, with whatever look each had of its own --
 * and projects saved then still carry them, which `normalizeClips` reads and
 * the studio makes into clip projects. The rest is choosing a stretch of a
 * recording by its ayahs, and naming what a stretch holds.
 *
 * Pure, so the rules can be tested without a studio.
 */

import { timelinePassage } from './projectPayload';

export interface RecordingClip {
  id: string;
  /** Seconds on the recording's clock, as its captions are. */
  start: number;
  end: number;
  /** What this clip changed from the project's look, or null when it had that look. */
  style: Record<string, unknown> | null;
}

/** Shorter than this is a slip of the pointer, not a clip. */
export const MIN_CLIP_SEC = 1;
/** The most of a pause before an ayah a clip by ayahs opens with, and after one it closes with. */
export const AYAH_LEAD_SEC = 0.5;
/** More than any recording is cut into; a bound on what a saved project can carry. */
export const MAX_CLIPS = 100;

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * When a clip was made, read from its id (the time in base 36, as the studio
 * made them), so every clip already saved has one; null for an id not made that way.
 */
export function clipMadeAt(id: string): number | null {
  const stamp = /^clip-([0-9a-z]+)-\d+$/.exec(id);
  const time = stamp ? parseInt(stamp[1], 36) : NaN;
  // From 2020 on, and not later than now: anything else is not a time.
  return Number.isFinite(time) && time >= Date.UTC(2020, 0, 1) && time <= Date.now() + 86_400_000 ? time : null;
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

/**
 * A stretch chosen on the timeline, widened or narrowed to whole ayahs: every
 * caption whose middle is inside it, then out to the first and last caption of
 * the ayahs those belong to, opened and closed on the pauses as a clip by
 * ayahs is (`ayahWindow`). A caption only grazed by the drag is left out, so a
 * stretch dragged a little past an ayah does not take the next one with it.
 * Null when no caption's middle is inside, to keep the stretch as dragged.
 */
export function snapToAyahs(
  verses: { verseKey?: string; startTime: number; endTime: number }[], start: number, end: number, duration: number
): { start: number; end: number } | null {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const held = verses
    .map((verse, i) => ({ i, mid: (verse.startTime + verse.endTime) / 2 }))
    .filter(({ mid }) => mid >= from && mid <= to)
    .map(({ i }) => i);
  if (!held.length) return null;
  let first = held[0];
  let last = held[held.length - 1];
  const sameAyah = (a: number, b: number) => !!verses[a].verseKey && verses[a].verseKey === verses[b].verseKey;
  while (first > 0 && sameAyah(first - 1, first)) first -= 1;
  while (last < verses.length - 1 && sameAyah(last + 1, last)) last += 1;
  return ayahWindow(verses, first, last, duration);
}

/** An ayah's key, as `2:255`; the basmala and anything else unnumbered are not one. */
const AYAH_KEY = /^\d+:\d+$/;

/**
 * The recording's ayahs in the order first heard, each with its first caption
 * and its last -- the last of all its captions, a repeat's included -- as
 * indices into `verses`, for choosing a clip by its first and last ayah.
 */
export function ayahList(verses: { verseKey?: string }[]): { key: string; first: number; last: number }[] {
  const found = new Map<string, { key: string; first: number; last: number }>();
  verses.forEach((verse, i) => {
    const key = verse.verseKey;
    if (!key || !AYAH_KEY.test(key)) return;
    const seen = found.get(key);
    if (seen) seen.last = i;
    else found.set(key, { key, first: i, last: i });
  });
  return [...found.values()];
}

/**
 * The clip from ayah `from` to ayah `to`, either way round: from its first
 * caption to the other's last, opened and closed on the pauses as any clip by
 * ayahs is (`ayahWindow`). Null when either is not in the recording.
 */
export function ayahRangeWindow(
  verses: { verseKey?: string; startTime: number; endTime: number }[], from: string, to: string, duration: number
): { start: number; end: number } | null {
  const ayahs = ayahList(verses);
  const a = ayahs.findIndex(ayah => ayah.key === from);
  const b = ayahs.findIndex(ayah => ayah.key === to);
  if (a < 0 || b < 0) return null;
  const [first, last] = a <= b ? [ayahs[a], ayahs[b]] : [ayahs[b], ayahs[a]];
  return ayahWindow(verses, first.first, Math.max(first.last, last.last), duration);
}

/** The first and last ayah heard in a stretch, as keys; null when it holds none. */
export function ayahsHeld(
  verses: { verseKey?: string; startTime: number; endTime: number }[], range: { start: number; end: number }
): { from: string; to: string } | null {
  const keys = clipVerses(verses, range).map(verse => verse.verseKey).filter((key): key is string => !!key && AYAH_KEY.test(key));
  return keys.length ? { from: keys[0], to: keys[keys.length - 1] } : null;
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

/** A clip project as `windowClipProject` compares it: the window it was made from, if one, and its stretch of the recording. */
export interface MadeClip {
  windowOf?: string;
  cut?: { start: number; end: number } | null;
}

/**
 * The clip project already made from a window of the old layout on a
 * recording (`recordingId`) -- made from that window, or cut from the same
 * stretch of the recording, as a copy of the project would have been -- or
 * undefined. `origin` is where the recording's own audio starts in the
 * original, for one that was trimmed: a clip's stretch is on the original's.
 */
export function windowClipProject<M extends MadeClip>(
  made: M[], recordingId: string, origin: number, clip: { id: string; start: number; end: number }
): M | undefined {
  return made.find(each => each.windowOf === `${recordingId}/${clip.id}`
    || (!!each.cut && Math.abs(each.cut.start - (origin + clip.start)) < 0.01 && Math.abs(each.cut.end - (origin + clip.end)) < 0.01));
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
