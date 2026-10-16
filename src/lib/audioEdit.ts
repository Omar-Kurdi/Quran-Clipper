/**
 * An edit of the recording: stretches cut out, a gentle speed-up, and the
 * clean-ups the server applies while it renders the result (`audioRender`).
 *
 * Kept as a list rather than as the audio it makes, for two reasons. A built-in
 * reciter's recording may be stored only while the Quran Foundation's Content
 * Sync keeps it current, so a saved project cannot hold an edited copy of it:
 * it holds this, and the server makes the audio again from the synced files.
 * And an upload edited twice is cut and sped up once, from the original, rather
 * than re-stretched from a copy that was already stretched.
 *
 * Every time here is on the *source* recording's clock. The captions are on
 * the edited one -- the clock of what plays and what exports -- and move
 * between the two through `toEdited` / `toSource`.
 */

export interface Span {
  start: number;
  end: number;
}

export interface AudioCut extends Span {
  /** Made by "Shorten long pauses", which takes these back when it is turned off. */
  auto?: boolean;
}

export interface AudioEdit {
  /** What is cut out, on the source's clock: sorted, apart, inside the recording. */
  cuts: AudioCut[];
  /** How much faster it plays, the reciter's pitch and voice kept (1-1.25). */
  tempo: number;
  /** Brought to the loudness streaming platforms play at. */
  loudness: boolean;
  /** Hum and room noise taken out: for a recording of one's own. */
  denoise: boolean;
  /**
   * An ending a Short or Reel loops from cleanly: the first moment faded in,
   * the last faded out, and `LOOP_TAIL_SEC` of silence after it, so the
   * recitation does not run straight back into its own beginning.
   */
  loop: boolean;
}

export const NO_EDIT: AudioEdit = { cuts: [], tempo: 1, loudness: false, denoise: false, loop: false };

/** Past this recitation sounds hurried, however well the pitch is kept. */
export const MAX_TEMPO = 1.25;
/** More than any passage has pauses; a bound on what a request can ask the server to do. */
export const MAX_CUTS = 400;
/** A cut shorter than this is no cut: it would be a click, not a pause shortened. */
export const MIN_CUT_SEC = 0.05;
/** Each side of a cut fades this long, so a join is never a click. */
export const CUT_FADE_SEC = 0.01;
/** Silence a loop-friendly ending adds after the last sound. */
export const LOOP_TAIL_SEC = 0.5;

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;
/** A moment this near a join is on it: times are kept to the millisecond. */
const JOIN_REACH_SEC = 0.0006;

/** Any value as an edit, made safe: what the studio sends and what the server accepts. */
export function normalizeEdit(value: unknown, duration?: number): AudioEdit {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AudioEdit, unknown>>;
  const length = typeof duration === 'number' && duration > 0 ? duration : Infinity;
  const spans = (Array.isArray(raw.cuts) ? raw.cuts : [])
    .map(cut => cut as Partial<AudioCut>)
    .filter(cut => Number.isFinite(cut?.start) && Number.isFinite(cut?.end))
    .map(cut => ({
      start: ms(Math.max(0, Number(cut.start))),
      end: ms(Math.min(length, Number(cut.end))),
      auto: cut.auto === true,
    }))
    .filter(cut => cut.end - cut.start >= MIN_CUT_SEC)
    .sort((a, b) => a.start - b.start);

  const cuts: AudioCut[] = [];
  for (const cut of spans) {
    const last = cuts[cuts.length - 1];
    if (last && cut.start <= last.end) {
      last.end = Math.max(last.end, cut.end);
      // A hand cut that swallowed an automatic one is the hand's.
      last.auto = last.auto && cut.auto;
    } else {
      cuts.push({ ...cut });
    }
  }
  const tempo = Number(raw.tempo);
  return {
    cuts: cuts.slice(0, MAX_CUTS).map(({ start, end, auto }) => (auto ? { start, end, auto } : { start, end })),
    tempo: Number.isFinite(tempo) ? Math.round(Math.min(MAX_TEMPO, Math.max(1, tempo)) * 100) / 100 : 1,
    loudness: raw.loudness === true,
    denoise: raw.denoise === true,
    loop: raw.loop === true,
  };
}

/** Whether the edit changes anything at all. */
export const isEdited = (edit: AudioEdit | null | undefined): edit is AudioEdit =>
  !!edit && (edit.cuts.length > 0 || edit.tempo !== 1 || edit.loudness || edit.denoise || edit.loop);

/** What is left of a recording `duration` long once `cuts` are taken out. */
export function keptSpans(cuts: Span[], duration: number): Span[] {
  const kept: Span[] = [];
  let at = 0;
  for (const cut of cuts) {
    if (cut.start > at) kept.push({ start: at, end: Math.min(cut.start, duration) });
    at = Math.max(at, cut.end);
  }
  if (duration > at) kept.push({ start: at, end: duration });
  return kept.filter(span => span.end > span.start);
}

/** How long the edited recording plays. */
export function editedLength(edit: AudioEdit, duration: number): number {
  const kept = keptSpans(edit.cuts, duration).reduce((sum, span) => sum + span.end - span.start, 0) / edit.tempo;
  return kept + (edit.loop ? LOOP_TAIL_SEC : 0);
}

/**
 * The last caption held to the end of what plays, which a loop-friendly
 * ending's silence runs past: the card stays up until the loop starts again,
 * rather than leaving an empty card for its last half second. Without one, a
 * caption reaching past the end is brought back to it.
 */
export function toTheEnd<V extends { startTime: number; endTime: number }>(verses: V[], edit: AudioEdit, length: number): V[] {
  const last = verses.reduce((at, verse, i) => (verse.endTime > (verses[at]?.endTime ?? -Infinity) ? i : at), -1);
  if (last < 0) return verses;
  const end = edit.loop ? length : Math.min(verses[last].endTime, length);
  if (end === verses[last].endTime) return verses;
  return verses.map((verse, i) => (i === last ? { ...verse, endTime: Math.round(end * 1000) / 1000 } : verse));
}

/**
 * A moment of the source on the edited clock. A moment inside a cut lands on
 * the join, where what was before the cut meets what was after it.
 */
export function toEdited(time: number, edit: AudioEdit): number {
  let removed = 0;
  for (const cut of edit.cuts) {
    if (time <= cut.start) break;
    if (time < cut.end) return ms((cut.start - removed) / edit.tempo);
    removed += cut.end - cut.start;
  }
  return ms((time - removed) / edit.tempo);
}

/**
 * A moment of the edited recording on the source's clock.
 *
 * A join is two moments of the source, the end of what was kept before the cut
 * and the start of what was kept after it: a caption ending there ended before
 * the cut, and one starting there starts after it. So putting a cut back gives
 * each caption its own edge again rather than both the same one.
 */
export function toSource(time: number, edit: AudioEdit, side: 'start' | 'end'): number {
  let removed = 0;
  for (const cut of edit.cuts) {
    // On the edited clock, which `toEdited` rounds to the millisecond.
    const join = (cut.start - removed) / edit.tempo;
    if (time < join - JOIN_REACH_SEC) break;
    if (time <= join + JOIN_REACH_SEC) return side === 'end' ? cut.start : cut.end;
    removed += cut.end - cut.start;
  }
  return ms(time * edit.tempo + removed);
}

interface Timed {
  startTime: number;
  endTime: number;
  words?: { timestamp?: number }[];
}

/** Shorter than this after a cut, a caption has had its audio cut away. */
const MIN_RETIMED_SEC = 0.05;

/**
 * Captions on the clock of one edit moved to the clock of another: through
 * the source, so a cut taken back gives back what it took. A caption whose
 * audio the new edit cuts away entirely goes with it.
 */
export function retime<V extends Timed>(verses: V[], from: AudioEdit, to: AudioEdit): V[] {
  if (from === to) return verses;
  const move = (time: number, side: 'start' | 'end') => toEdited(toSource(time, from, side), to);
  return verses
    .map(verse => {
      const startTime = move(verse.startTime, 'start');
      const endTime = move(verse.endTime, 'end');
      const words = verse.words?.map(word =>
        typeof word.timestamp === 'number' ? { ...word, timestamp: move(word.timestamp, 'start') } : word
      );
      return { ...verse, startTime, endTime, ...(words ? { words } : {}) };
    })
    .filter(verse => verse.endTime - verse.startTime >= MIN_RETIMED_SEC);
}

/** The edit with `spans` cut as well, by hand. */
export function withCuts(edit: AudioEdit, spans: Span[], duration?: number): AudioEdit {
  return normalizeEdit({ ...edit, cuts: [...edit.cuts, ...spans] }, duration);
}

/** The edit with nothing cut outside `keep`: what a trim to `keep` does to it. */
export function trimmedTo(edit: AudioEdit, keep: Span, duration: number): AudioEdit {
  return withCuts(edit, [{ start: 0, end: keep.start }, { start: keep.end, end: duration }], duration);
}

/**
 * The edit as a short url-safe string, for the address a built-in reciter's
 * edited recording is played from. Times to the millisecond.
 */
export function encodeEdit(edit: AudioEdit): string {
  const compact = {
    c: edit.cuts.map(cut => (cut.auto ? [cut.start, cut.end, 1] : [cut.start, cut.end])),
    t: edit.tempo,
    l: edit.loudness ? 1 : 0,
    d: edit.denoise ? 1 : 0,
    ...(edit.loop ? { p: 1 } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An `encodeEdit` string back as an edit, or null for anything else. */
export function decodeEdit(text: string): AudioEdit | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const compact = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    if (!compact || typeof compact !== 'object' || !Array.isArray(compact.c)) return null;
    return normalizeEdit({
      cuts: (compact.c as unknown[]).map(entry => {
        const [start, end, auto] = Array.isArray(entry) ? entry : [];
        return { start, end, auto: auto === 1 };
      }),
      tempo: compact.t,
      loudness: compact.l === 1,
      denoise: compact.d === 1,
      loop: compact.p === 1,
    });
  } catch {
    return null;
  }
}

const PASSAGE_PATH = '/api/audio/ayahs';
const EDITED_PATH = '/api/audio/edited';

/**
 * Where a built-in reciter's passage plays with `edit` applied: the passage's
 * own address on the edited route, the edit beside it. Null for any other
 * recording, which the server cannot rebuild from an address.
 */
export function editedAddress(passage: string, edit: AudioEdit): string | null {
  let url: URL;
  try {
    url = new URL(passage, 'http://studio.invalid');
  } catch {
    return null;
  }
  if (url.pathname !== PASSAGE_PATH) return null;
  url.searchParams.set('edit', encodeEdit(edit));
  return `${EDITED_PATH}${url.search}`;
}

/**
 * What a saved project's `audioUrl` names: the recording itself, and the edit
 * applied to it. A project stores the edited address -- the edit has no column
 * of its own -- so this is how it is read back. An upload's address is only
 * the edit; its recording is the stored file.
 */
export function splitAddress(address: string): { source: string; edit: AudioEdit | null } {
  let url: URL;
  try {
    url = new URL(address, 'http://studio.invalid');
  } catch {
    return { source: address, edit: null };
  }
  if (url.pathname !== EDITED_PATH) return { source: address, edit: null };
  const edit = decodeEdit(url.searchParams.get('edit') || '');
  url.searchParams.delete('edit');
  const passage = url.searchParams.has('reciter') ? `${PASSAGE_PATH}${url.search}` : '';
  return { source: passage, edit: isEdited(edit) ? edit : null };
}

/** The address a saved project keeps for an upload's edit, its recording stored apart. */
export const uploadEditAddress = (edit: AudioEdit): string => `${EDITED_PATH}?edit=${encodeEdit(edit)}`;
