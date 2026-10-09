/**
 * Handing a ground-truth file, and the audio it describes, to the studio's
 * server to write into `scripts/` (`/api/ground-truth`).
 */

import type { VerseData } from './quranData';

/** The audio a ground-truth file is saved with: an upload, or a reciter's passage for the server to cut. */
export interface GroundTruthClip {
  name: string;
  file?: File;
  recording?: { url: string; start: number; end: number };
}

/**
 * The upload, or for a built-in reciter the passage the server cuts out of
 * their chapter recording -- from the first caption to the last, with a little
 * either side.
 *
 * A reciter's clip used to have no file in the tab, so the save skipped the
 * server and fell back to a browser download, which asked where to put it,
 * and the file it gave named a recording `gauge.sh` could not open.
 */
export function groundTruthClip(
  upload: { file: File; name: string } | null,
  reciter: { url: string; id: string; surah: number; start: number; end: number } | null,
  verses: Pick<VerseData, 'startTime' | 'endTime'>[]
): GroundTruthClip | null {
  if (upload) return upload;
  if (!reciter?.url || !verses.length) return null;
  return {
    name: `${reciter.id}-${String(reciter.surah).padStart(3, '0')}_${reciter.start}-${reciter.end}.wav`,
    recording: {
      url: reciter.url,
      start: Math.max(0, Math.min(...verses.map(verse => verse.startTime)) - 0.5),
      end: Math.max(...verses.map(verse => verse.endTime)) + 0.5,
    },
  };
}

/**
 * Asks the server to write the file and its audio. `fallback` when the tab
 * can still offer something in its place -- the text file, for an upload the
 * person has on disk; a reciter's passage has nothing to fall back on.
 */
export async function saveGroundTruth(
  contents: string, clip: GroundTruthClip, audioName: string
): Promise<{ written: string[] } | { error: string; fallback: boolean }> {
  const body = new FormData();
  // A Blob, not a string: a multipart encoder normalises the newlines in a
  // *text* field to CRLF, and the file it wrote then carried `\r` on every
  // line -- enough for `gauge.sh` to read `# trim: none` as a trim window and
  // label an untrimmed clip "(trimmed)". Blob bytes go through untouched.
  body.set('contents', new Blob([contents], { type: 'text/plain;charset=utf-8' }));
  body.set('clipName', clip.name);
  if (clip.file) body.set('audio', clip.file, audioName);
  if (clip.recording) {
    body.set('audioUrl', clip.recording.url);
    body.set('windowStart', String(clip.recording.start));
    body.set('windowEnd', String(clip.recording.end));
  }
  try {
    const res = await fetch('/api/ground-truth', { method: 'POST', body });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) return { written: data.written as string[] };
    return { error: data?.error || `HTTP ${res.status}`, fallback: !clip.recording };
  } catch (err) {
    return { error: (err as Error).message, fallback: !clip.recording };
  }
}
