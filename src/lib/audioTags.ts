/**
 * What an uploaded recording says about itself in its ID3 tag: the artist --
 * for a surah file, its reciter -- its title, album and track number, which
 * for a surah file is usually the surah's. Read in the browser from the start
 * of the file, so nothing is uploaded to learn it. Pure, so it can be tested.
 *
 * ID3v2.2, 2.3 and 2.4: their frame ids and sizes differ (2.4's are
 * synchsafe), a tag may be unsynchronised as a whole or, in 2.4, frame by
 * frame, and text comes in any of four encodings.
 */

export interface AudioTags {
  artist?: string;
  title?: string;
  album?: string;
  /** The track number, as the number before any `/total`. */
  track?: number;
}

/** The frames read, by id: 2.3 and 2.4's, then 2.2's. */
const FRAMES: Record<string, keyof AudioTags> = {
  TPE1: 'artist', TIT2: 'title', TALB: 'album', TRCK: 'track',
  TP1: 'artist', TT2: 'title', TAL: 'album', TRK: 'track',
};

/** How much of a file the tag is read from; cover art past this is not needed. */
export const TAG_HEAD_BYTES = 1 << 20;
const MAX_TEXT = 200;

const synchsafe = (b: Uint8Array, at: number) => (b[at] << 21) | (b[at + 1] << 14) | (b[at + 2] << 7) | b[at + 3];
const plain32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** Undoes unsynchronisation: every 0xFF 0x00 was written for a lone 0xFF. */
function resync(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i]);
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

/** A text frame's value: its encoding byte, then the text; the first of several values. */
function frameText(body: Uint8Array): string {
  if (!body.length) return '';
  const encoding = body[0];
  const text = body.subarray(1);
  const label = encoding === 0 ? 'latin1' : encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : 'utf-8';
  try {
    return new TextDecoder(label).decode(text).split('\u0000')[0].replace(/^﻿/, '').trim().slice(0, MAX_TEXT);
  } catch {
    return '';
  }
}

/** The tag's frames, unsynchronised where the whole tag was, and where they start; null when there is no tag. */
function tagFrames(bytes: Uint8Array): { tag: Uint8Array; version: number; at: number } | null {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const version = bytes[3];
  if (version < 2 || version > 4) return null;
  const flags = bytes[5];
  let tag = bytes.subarray(10, Math.min(bytes.length, 10 + synchsafe(bytes, 6)));
  // 2.2 and 2.3 unsynchronise the whole tag; 2.4 says so frame by frame instead.
  if (flags & 0x80 && version < 4) tag = resync(tag);
  // An extended header is skipped: 2.4 counts itself in its size, 2.3 does not.
  const extended = flags & 0x40 && version > 2;
  return { tag, version, at: !extended ? 0 : version === 4 ? synchsafe(tag, 0) : plain32(tag, 0) + 4 };
}

/** The frame at `at`: its id, its body as stored, and where the next starts; null at the padding or a broken frame. */
function frameAt(tag: Uint8Array, at: number, version: number): { id: string; body: Uint8Array; next: number } | null {
  const head = version === 2 ? 6 : 10;
  if (at + head > tag.length || tag[at] === 0) return null;
  const id = String.fromCharCode(...tag.subarray(at, at + (version === 2 ? 3 : 4)));
  const size = version === 2 ? (tag[at + 3] << 16) | (tag[at + 4] << 8) | tag[at + 5]
    : version === 4 ? synchsafe(tag, at + 4) : plain32(tag, at + 4);
  if (!/^[A-Z0-9]+$/.test(id) || size <= 0 || at + head + size > tag.length) return null;
  let body = tag.subarray(at + head, at + head + size);
  if (version === 4) {
    // A data length indicator comes first when the frame says it has one.
    if (tag[at + 9] & 0x01) body = body.subarray(4);
    if (tag[at + 9] & 0x02) body = resync(body);
  }
  return { id, body, next: at + head + size };
}

/** Keeps a frame's value if it is one read here and the first of its kind. */
function keep(found: AudioTags, id: string, body: Uint8Array) {
  const field = FRAMES[id];
  if (!field || found[field] !== undefined) return;
  const text = frameText(body);
  if (field !== 'track') {
    if (text) found[field] = text;
    return;
  }
  const track = parseInt(text, 10);
  if (track > 0) found.track = track;
}

/** The tags at the start of `bytes`, or null when there is no ID3v2 tag there or it names nothing read here. */
export function readAudioTags(bytes: Uint8Array): AudioTags | null {
  const frames = tagFrames(bytes);
  if (!frames) return null;
  const found: AudioTags = {};
  for (let frame = frameAt(frames.tag, frames.at, frames.version); frame; frame = frameAt(frames.tag, frame.next, frames.version)) {
    keep(found, frame.id, frame.body);
  }
  return Object.keys(found).length ? found : null;
}

/** Tags as sent with a project, kept to what is read here; null for anything else. */
export function normalizeAudioTags(value: unknown): AudioTags | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const out: AudioTags = {};
  for (const field of ['artist', 'title', 'album'] as const) {
    const text = raw[field];
    if (typeof text === 'string' && text.trim()) out[field] = text.trim().slice(0, MAX_TEXT);
  }
  if (Number.isInteger(raw.track) && (raw.track as number) > 0 && (raw.track as number) < 1000) out.track = raw.track as number;
  return Object.keys(out).length ? out : null;
}
