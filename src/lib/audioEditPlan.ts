/**
 * The edits the studio works out for itself: which pauses to shorten and by
 * how much, how to fit a clip into a length, where the voice starts and ends,
 * and what an opening or an ayah takes with it. Each returns cuts for
 * `audioEdit`; nothing here touches audio.
 *
 * Every time is on the source recording's clock, the captions included.
 */

import { editedLength, MAX_TEMPO, MIN_CUT_SEC, normalizeEdit, type AudioCut, type AudioEdit, type Span } from './audioEdit';
import { isOpening } from './openings';

/** Shorter than this, a silence is the gap between two words and is left alone. */
export const MIN_SILENCE_SEC = 0.25;
/** How far under the reciter's own level a stretch has to be to count as silence. */
const SILENCE_BELOW_SPEECH_DB = 30;
/** On a noisy recording, how far over its hiss: the hiss is the silence there. */
const SILENCE_OVER_FLOOR_DB = 4;
/** A recording whose hiss is within this of the voice has no silence to find. */
const MIN_HEADROOM_DB = 15;
/** Samples this quiet are digital silence, the joins between ayah files: no part of the room's level. */
const DIGITAL_SILENCE_DB = -90;

/**
 * Where the recording is silent: nothing but the room, read from its own
 * samples, so it is there whether or not the passage has been matched.
 *
 * Strict on purpose. A held madd, a ghunnah or a sung note fading out is quiet
 * next to the reciter's full voice -- the first version took measured quiet
 * (6 dB down) with the phoneme model hearing nothing, and cut Al-Minshawi's
 * Mujawwad 32:16-18 where he was still sounding 5-9 dB under his level -- but
 * it is nowhere near silence. Silence here is 30 dB under the level 70% of the
 * recording reaches, or on a hissy one just over the hiss itself; any frame
 * louder than that ends the stretch, so a cut inside one removes only silence.
 */
export function silentSpans(channels: Float32Array[], sampleRate: number): Span[] {
  const hop = Math.max(1, Math.round(FRAME_SEC * sampleRate));
  const length = Math.min(...channels.map(channel => channel.length));
  const db: number[] = [];
  for (let i = 0; i + hop <= length; i += hop) {
    let sum = 0;
    for (const channel of channels) for (let k = i; k < i + hop; k++) sum += channel[k] * channel[k];
    db.push(10 * Math.log10(sum / (hop * channels.length) + 1e-12));
  }
  const room = db.filter(level => level > DIGITAL_SILENCE_DB).sort((a, b) => a - b);
  if (!room.length) return [];
  const speech = room[Math.floor(room.length * 0.7)];
  const floor = room[Math.floor(room.length * 0.05)];
  if (speech - floor < MIN_HEADROOM_DB) return [];
  const threshold = Math.max(speech - SILENCE_BELOW_SPEECH_DB, floor + SILENCE_OVER_FLOOR_DB);
  const spans: Span[] = [];
  let from: number | null = null;
  db.forEach((level, i) => {
    if (level < threshold) from ??= i;
    else if (from !== null) {
      spans.push({ start: from * FRAME_SEC, end: i * FRAME_SEC });
      from = null;
    }
  });
  if (from !== null) spans.push({ start: from * FRAME_SEC, end: db.length * FRAME_SEC });
  return spans.filter(span => span.end - span.start >= MIN_SILENCE_SEC)
    .map(span => ({ start: Math.round(span.start * 1000) / 1000, end: Math.round(span.end * 1000) / 1000 }));
}

/** The silences inside `within`, cut to it: what "Shorten silence" works on in a selection. */
export const silencesWithin = (silences: Span[], within: Span): Span[] =>
  silences
    .map(span => ({ start: Math.max(span.start, within.start), end: Math.min(span.end, within.end) }))
    .filter(span => span.end - span.start >= MIN_SILENCE_SEC);

export type PauseKind = 'ayah' | 'stop' | 'breath';

/**
 * The least of a pause that is kept, by what it ends. An ayah's end is where
 * the reciter rests; a stop sign inside an ayah is a shorter rest; a breath
 * with no sign is shortest. Never nothing: recitation run back to back is not
 * recitation.
 */
export const PAUSE_FLOOR: Record<PauseKind, number> = { ayah: 0.7, stop: 0.5, breath: 0.35 };
/** A long pause keeps a little more than the floor, so the rhythm still breathes. */
const KEEP_SHARE = 0.15;
const KEEP_EXTRA_MAX = 0.3;
/** Of what is kept, the share before the cut: the voice dying away is longer than the breath in. */
const KEPT_BEFORE = 0.6;
/** How far from a pause a caption's change can sit and still be the pause's. */
const BOUNDARY_REACH_SEC = 0.25;

interface Timed {
  verseKey: string;
  startTime: number;
  endTime: number;
  words?: { arabic?: string; timestamp?: number }[];
}

/** The mushaf's signs that a reciter may stop here, as `publishedPhrases` reads them. */
const STOP_SIGNS = /[\u06D6\u06D7\u06D8\u06DA\u06DB]\s*$/;

/**
 * What a pause ends: an ayah, a stop inside one, or neither. A caption's
 * change says which where there is one; inside a caption, the word the pause
 * follows does -- a whole Mujawwad ayah is often one caption, and Al-Minshawi
 * rests six seconds at 32:18's «فَاسِقًا ۚ» inside it.
 */
export function pauseKind(pause: Span, verses: Timed[]): PauseKind {
  for (let i = 0; i + 1 < verses.length; i++) {
    const change = (verses[i].endTime + verses[i + 1].startTime) / 2;
    if (change < pause.start - BOUNDARY_REACH_SEC || change > pause.end + BOUNDARY_REACH_SEC) continue;
    return verses[i].verseKey === verses[i + 1].verseKey ? 'stop' : 'ayah';
  }
  let before: string | undefined;
  let at = -Infinity;
  for (const verse of verses) {
    for (const word of verse.words || []) {
      if (typeof word.timestamp === 'number' && word.timestamp <= pause.start && word.timestamp > at) {
        at = word.timestamp;
        before = word.arabic;
      }
    }
  }
  return before && STOP_SIGNS.test(before) ? 'stop' : 'breath';
}

/** How much of a pause `length` long ending `kind` is kept. */
export function keptPause(length: number, kind: PauseKind): number {
  const floor = PAUSE_FLOOR[kind];
  return Math.min(length, floor + Math.min(KEEP_EXTRA_MAX, KEEP_SHARE * Math.max(0, length - floor)));
}

/**
 * "Shorten long pauses": each silence inside the captions cut down to what it
 * keeps, from its middle, so what is left either side of the cut is silence
 * too and the voice is never touched.
 */
export function pauseCuts(pauses: Span[], verses: Timed[]): AudioCut[] {
  // An upload not yet matched has no captions to tell an ayah's end from a
  // breath, so every pause keeps an ayah end's rest.
  const first = verses.length ? Math.min(...verses.map(v => v.startTime)) : 0;
  const last = verses.length ? Math.max(...verses.map(v => v.endTime)) : Infinity;
  const cuts: AudioCut[] = [];
  for (const pause of pauses) {
    if (pause.start < first || pause.end > last) continue;
    const length = pause.end - pause.start;
    const keep = keptPause(length, verses.length ? pauseKind(pause, verses) : 'ayah');
    if (length - keep < MIN_CUT_SEC * 2) continue;
    cuts.push({ start: pause.start + keep * KEPT_BEFORE, end: pause.end - keep * (1 - KEPT_BEFORE), auto: true });
  }
  return cuts;
}

/** The edit with its automatic cuts replaced by `auto`, or taken out when `auto` is empty. */
export function withAutoCuts(edit: AudioEdit, auto: AudioCut[], duration: number): AudioEdit {
  return normalizeEdit({ ...edit, cuts: [...edit.cuts.filter(cut => !cut.auto), ...auto] }, duration);
}

export interface FitResult {
  edit: AudioEdit;
  /** Seconds still over the target at the fastest speed allowed; 0 when it fits. */
  over: number;
  /** The ayahs, last first, whose leaving out would make it fit. */
  drop: string[];
}

/**
 * The gentlest edit that plays in `target` seconds: pauses shortened first,
 * and only then the smallest speed-up, never past `MAX_TEMPO`. When even that
 * is too long, how far over it is and which ayahs at the end would have to go.
 */
export function fitToLength(params: {
  target: number;
  duration: number;
  edit: AudioEdit;
  /** The automatic cuts on offer, when the pauses are known. */
  auto: AudioCut[];
  verses: Timed[];
}): FitResult {
  const { target, duration, verses } = params;
  const plain = normalizeEdit({ ...params.edit, tempo: 1 }, duration);
  const handOnly = withAutoCuts(plain, [], duration);
  if (editedLength(handOnly, duration) <= target) return { edit: handOnly, over: 0, drop: [] };
  const shortened = params.auto.length ? withAutoCuts(plain, params.auto, duration) : handOnly;
  const length = editedLength(shortened, duration);
  if (length <= target) return { edit: shortened, over: 0, drop: [] };
  const tempo = Math.ceil((length / target) * 100) / 100;
  if (tempo <= MAX_TEMPO) return { edit: { ...shortened, tempo }, over: 0, drop: [] };

  const fastest = { ...shortened, tempo: MAX_TEMPO };
  const over = editedLength(fastest, duration) - target;
  const ayahs = ayahSpans(verses);
  const drop: string[] = [];
  for (let i = ayahs.length - 1; i > 0; i--) {
    drop.push(ayahs[i].verseKey);
    const without = normalizeEdit({ ...fastest, cuts: [...fastest.cuts, { start: ayahs[i].start, end: duration }] }, duration);
    if (editedLength(without, duration) <= target) return { edit: fastest, over, drop };
  }
  return { edit: fastest, over, drop: [] };
}

/** Each ayah's stretch of the recording, captions of one ayah together, in order. */
export function ayahSpans(verses: Timed[]): (Span & { verseKey: string })[] {
  const out: (Span & { verseKey: string })[] = [];
  for (const verse of [...verses].sort((a, b) => a.startTime - b.startTime)) {
    const last = out[out.length - 1];
    if (last && last.verseKey === verse.verseKey) last.end = Math.max(last.end, verse.endTime);
    else out.push({ verseKey: verse.verseKey, start: verse.startTime, end: verse.endTime });
  }
  return out;
}

/** Kept before the first word, as a built-in reciter's first caption is (`toTheVoice`). */
export const VOICE_LEAD_SEC = 0.4;
/** Kept after the voice stops, for it to die away. */
export const VOICE_TAIL_SEC = 1;
const FRAME_SEC = 0.02;
/** Loud for this long, a sound is the voice and not a click. */
const VOICE_MIN_SEC = 0.1;

/**
 * Where the voice starts and ends in a recording, read from its samples, with
 * the lead and tail a built-in reciter's passage keeps. Quiet against the
 * recording's own level, as the sidecar measures it: 10 dB under the level 70%
 * of the recording reaches.
 */
export function voiceSpan(samples: Float32Array, sampleRate: number): Span | null {
  const hop = Math.max(1, Math.round(FRAME_SEC * sampleRate));
  const db: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let k = i; k < i + hop; k++) sum += samples[k] * samples[k];
    db.push(10 * Math.log10(sum / hop + 1e-12));
  }
  if (!db.length) return null;
  const sorted = [...db].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.7)] - 10;
  const run = Math.ceil(VOICE_MIN_SEC / FRAME_SEC);
  const loud = db.map(level => level >= threshold);
  const firstRun = (order: number[]) => {
    let count = 0;
    for (const i of order) {
      count = loud[i] ? count + 1 : 0;
      if (count >= run) return i;
    }
    return null;
  };
  const indices = db.map((_, i) => i);
  const firstEnd = firstRun(indices);
  const lastStart = firstRun([...indices].reverse());
  if (firstEnd === null || lastStart === null) return null;
  const duration = samples.length / sampleRate;
  const voiceStart = (firstEnd - run + 1) * FRAME_SEC;
  const voiceEnd = (lastStart + run) * FRAME_SEC;
  return { start: Math.max(0, voiceStart - VOICE_LEAD_SEC), end: Math.min(duration, voiceEnd + VOICE_TAIL_SEC) };
}

interface WithWords extends Timed {
  words?: { timestamp?: number }[];
}

/**
 * The isti'adha and basmala before the passage, as a cut: from where the first
 * is heard to just before the passage's first word, so the clip starts the way
 * a built-in reciter's does. Null when the captions hold no opening.
 */
export function openingCut(verses: WithWords[]): Span | null {
  const sorted = [...verses].sort((a, b) => a.startTime - b.startTime);
  const firstAyah = sorted.find(verse => !isOpening(verse));
  const openings = sorted.filter(verse => isOpening(verse) && (!firstAyah || verse.startTime < firstAyah.startTime));
  if (!openings.length || !firstAyah) return null;
  const word = firstAyah.words?.find(w => typeof w.timestamp === 'number')?.timestamp;
  const voice = typeof word === 'number' && word >= firstAyah.startTime ? word : firstAyah.startTime;
  const start = openings[0].startTime < VOICE_LEAD_SEC ? 0 : openings[0].startTime;
  const end = Math.max(start, voice - VOICE_LEAD_SEC);
  return end - start >= MIN_CUT_SEC ? { start, end } : null;
}
