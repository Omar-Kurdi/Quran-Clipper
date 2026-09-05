/**
 * The working project, written down where a refresh cannot take it.
 *
 * Everything in the studio lives in component state: a stray Ctrl+R, a crash,
 * or a laptop closing at the wrong moment threw away an afternoon of caption
 * timing, and "Save project" is a deliberate act that nobody performs at the
 * moment they are about to lose the work.
 *
 * What is stored is the project, not the session -- the timeline, the styling
 * and which passage it is. Two things deliberately do not survive:
 *
 *  - `blob:` urls. An uploaded file's url is minted per page load and is dead
 *    on the next one. Restoring a timeline pointed at a dead url would look
 *    like the audio or the background silently broke, so the url is dropped and
 *    the file name kept, which at least says what to pick again.
 *  - the sample project. The studio opens with Al-Fatihah already loaded;
 *    saving that would invent a draft the user never made and then offer it
 *    back to them. The caller gates on `isSampleProject`.
 *
 * Fetched translations are stripped for a third reason: size. Three of them
 * across Al-Baqarah is megabytes of text that the API will hand back on
 * request, and a draft that will not fit turns auto-save off for the session --
 * so the *choice* is stored and the text is asked for again on restore.
 */

import { VerseData } from './quranData';

export const DRAFT_KEY = 'qc-draft';

/** Bumped when the shape below changes. A draft from another shape is discarded, not guessed at. */
export const DRAFT_VERSION = 1;

export interface ProjectDraft {
  version: number;
  /** Epoch milliseconds, so the banner can say how old the work is. */
  savedAt: number;
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
  reciterId: string;
  /** Empty when the recitation was an uploaded file: that url cannot be reopened. */
  audioUrl: string;
  /** The uploaded file's name, so the restore banner can name what to pick again. */
  audioUploadName: string;
  verses: VerseData[];
  config: Record<string, unknown>;
  /** Backgrounds that were uploads, and so could not be written down. */
  droppedBackgrounds: number;
}

export interface DraftInput {
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
  reciterId: string;
  audioUrl: string;
  audioUploadName: string;
  verses: VerseData[];
  config: Record<string, unknown>;
  savedAt?: number;
}

/** True for a url that only means something to the page that made it. */
export const isTransientUrl = (url: unknown): boolean =>
  typeof url === 'string' && url.startsWith('blob:');

interface StrippedConfig {
  config: Record<string, unknown>;
  dropped: number;
}

/** Takes the uploads out of a styling config, and counts what went. */
function stripUploads(config: Record<string, unknown>): StrippedConfig {
  let dropped = 0;
  const next: Record<string, unknown> = { ...config };

  if (isTransientUrl(next.bgUrl)) {
    next.bgUrl = '';
    dropped++;
  }
  if (Array.isArray(next.bgUrls)) {
    const kept = (next.bgUrls as unknown[]).filter(url => !isTransientUrl(url));
    dropped += next.bgUrls.length - kept.length;
    next.bgUrls = kept;
  }
  if (Array.isArray(next.bgSegments)) {
    const kept = (next.bgSegments as { url?: unknown }[]).filter(seg => !isTransientUrl(seg?.url));
    dropped += next.bgSegments.length - kept.length;
    next.bgSegments = kept;
  }
  return { config: next, dropped };
}

export function buildDraft(input: DraftInput): ProjectDraft {
  const { config, dropped } = stripUploads(input.config);
  const uploaded = isTransientUrl(input.audioUrl);
  // Re-fetchable by verse key, and by far the largest thing a caption carries.
  const verses = input.verses.map(verse => {
    if (!verse.translations) return verse;
    const { translations: _fetched, ...rest } = verse;
    return rest as VerseData;
  });
  return {
    version: DRAFT_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    surahNumber: input.surahNumber,
    surahNameArabic: input.surahNameArabic,
    surahNameEnglish: input.surahNameEnglish,
    ayahStart: input.ayahStart,
    ayahEnd: input.ayahEnd,
    reciterId: input.reciterId,
    audioUrl: uploaded ? '' : input.audioUrl,
    audioUploadName: uploaded ? input.audioUploadName : '',
    verses,
    config,
    droppedBackgrounds: dropped
  };
}

/**
 * `blocked` means storage refused it -- out of quota, or unavailable. The caller
 * stops trying rather than failing again every few seconds for the rest of the
 * session.
 */
export function saveDraft(draft: ProjectDraft): 'saved' | 'blocked' {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return 'saved';
  } catch {
    return 'blocked';
  }
}

/** The stored draft, or null when there is none this version can read. */
export function readDraft(): ProjectDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectDraft>;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    if (!Array.isArray(parsed.verses) || parsed.verses.length === 0) return null;
    if (!parsed.config || typeof parsed.config !== 'object') return null;
    return {
      version: DRAFT_VERSION,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
      surahNumber: typeof parsed.surahNumber === 'number' ? parsed.surahNumber : 1,
      surahNameArabic: parsed.surahNameArabic || '',
      surahNameEnglish: parsed.surahNameEnglish || '',
      ayahStart: typeof parsed.ayahStart === 'number' ? parsed.ayahStart : 1,
      ayahEnd: typeof parsed.ayahEnd === 'number' ? parsed.ayahEnd : 1,
      reciterId: parsed.reciterId || '',
      audioUrl: parsed.audioUrl || '',
      audioUploadName: parsed.audioUploadName || '',
      verses: parsed.verses as VerseData[],
      config: parsed.config as Record<string, unknown>,
      droppedBackgrounds:
        typeof parsed.droppedBackgrounds === 'number' ? parsed.droppedBackgrounds : 0
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do: an unreadable store is also an unwritable one.
  }
  forgetRecoverableDraft();
}

// ---------------------------------------------------------------------------
// The draft found at startup, as a store.
//
// `localStorage` does not exist while the server renders the studio, so this
// cannot be read during render or in a lazy initialiser without the markup
// disagreeing on hydration -- and reading it in an effect means setting state
// from an effect body, which is the cascading render React now warns about.
// An external store answers both: a server snapshot that is always `null`, and
// a client snapshot read once and cached so its identity is stable.
// ---------------------------------------------------------------------------

let recoverable: ProjectDraft | null | undefined;
const listeners = new Set<() => void>();

export function subscribeToDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The draft waiting to be restored, read from storage the first time it is asked for. */
export function recoverableDraft(): ProjectDraft | null {
  if (recoverable === undefined) recoverable = readDraft();
  return recoverable;
}

/** The server has no storage, so it renders as though there were no draft. */
export function serverRecoverableDraft(): ProjectDraft | null {
  return null;
}

/**
 * Takes the offer off the screen without touching what is stored.
 *
 * What a restore wants: the work is now in the studio, and auto-save will write
 * over the stored copy on its own. Discarding calls `clearDraft` instead.
 */
export function forgetRecoverableDraft(): void {
  if (recoverable === null) return;
  recoverable = null;
  listeners.forEach(listener => listener());
}
