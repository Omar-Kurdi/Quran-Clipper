/**
 * Matching several recitations in one go.
 *
 * Each file goes through `/api/audio/match` exactly as a single upload does --
 * same route, same matcher the studio has selected, detection on -- one after
 * another, and its timeline is kept beside it. Nothing is loaded into the
 * studio until asked for: a batch of ten would otherwise leave the studio
 * showing whichever finished last.
 *
 * Runs in this tab. Closing it ends the batch; a batch that outlives the tab
 * needs a server-side worker, which the studio does not have.
 */

import type { VerseData } from './quranData';

export type BatchStatus = 'waiting' | 'matching' | 'done' | 'failed';

/** What a match found, in the shape `/api/audio/match` returns it. */
export interface BatchResult {
  verses: VerseData[];
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
  audioDuration: number;
  warning: string | null;
  /** "Al-Baqarah 2:255-257" or similar, for the list. */
  title: string;
}

export interface BatchItem {
  id: string;
  file: File;
  status: BatchStatus;
  result?: BatchResult;
  error?: string;
  /** Set once saved as a project, so it is not saved twice. */
  saved?: boolean;
}

let counter = 0;

export function batchItems(files: File[]): BatchItem[] {
  return files.map(file => {
    counter += 1;
    return { id: `batch-${counter}`, file, status: 'waiting' as const };
  });
}

/**
 * Adds files, skipping any already in the list under the same name and size --
 * a second drop of the same folder is the same recordings.
 */
export function addBatchFiles(items: BatchItem[], files: File[]): BatchItem[] {
  const seen = new Set(items.map(item => `${item.file.name}:${item.file.size}`));
  const fresh = files.filter(file => !seen.has(`${file.name}:${file.size}`));
  return [...items, ...batchItems(fresh)];
}

export function updateBatchItem(items: BatchItem[], id: string, change: Partial<BatchItem>): BatchItem[] {
  return items.map(item => (item.id === id ? { ...item, ...change } : item));
}

export const nextBatchItem = (items: BatchItem[]): BatchItem | undefined =>
  items.find(item => item.status === 'waiting');

/** Reads a successful `/api/audio/match` body into a result, or null when it is not one. */
export function batchResultFrom(data: Record<string, unknown> | null): BatchResult | null {
  if (!data || data.success !== true || !Array.isArray(data.verses) || !data.verses.length) return null;
  const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const surahNumber = number(data.surahNumber, 1);
  return {
    verses: data.verses as VerseData[],
    surahNumber,
    surahNameArabic: text(data.surahNameArabic),
    surahNameEnglish: text(data.surahNameEnglish),
    ayahStart: number(data.ayahStart, 1),
    ayahEnd: number(data.ayahEnd, 1),
    audioDuration: number(data.audioDuration, 0),
    warning: typeof data.warning === 'string' ? data.warning : null,
    title: text(data.timelineTitle) || text(data.surahNameEnglish) || `Surah ${surahNumber}`
  };
}

/**
 * Matches one file. Resolves to its result, or rejects with the route's own
 * reason -- a missing key or a stopped helper is said the same way it would
 * be for a single upload.
 */
export async function matchFile(
  file: File,
  provider: string,
  durationSeconds: number,
  fallbackError: string
): Promise<BatchResult> {
  const form = new FormData();
  form.append('audio', file);
  form.append('provider', provider);
  if (durationSeconds > 0) form.append('audioDuration', String(durationSeconds));
  const res = await fetch('/api/audio/match', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const result = res.ok ? batchResultFrom(data) : null;
  if (!result) throw new Error(typeof data?.error === 'string' ? data.error : fallbackError);
  return result;
}
