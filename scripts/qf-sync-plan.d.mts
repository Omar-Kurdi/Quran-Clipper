/** Types for qf-sync-plan.mjs, so its tests type-check. */

export interface SyncEntry { syncedAt?: string | null }
export interface Mutation { type: string; sequence?: number }
export interface AudioRecord {
  record_type: string;
  verse_key?: string;
  verse_number?: number;
  chapter_id?: number;
  url: string;
  segments?: unknown[];
  updated_at?: string | null;
}
/** Word timings as stored: numbers, or text in chapters downloaded before the script coerced them. */
export interface StoredAyah { ayah: number; file: string; ms: number; segments: (number | string)[][]; url?: string; updatedAt?: string | null }
export interface StoredChapter { qfId?: number; surah?: number; ayahs: StoredAyah[] }

export declare const SYNC_MAX_AGE_MS: number;
export declare const SYNC_DUE_AFTER_MS: number;
export declare function syncDue(entry: SyncEntry | undefined, now?: number): boolean;
export declare function apiPath(url: string | null | undefined): string | null;
export declare function mutationPlan(mutations: Mutation[] | undefined): { deleted: boolean; snapshot: boolean };
export declare function normalSegments(segments: unknown[] | undefined): number[][];
export declare function recordsBySurah(records: AudioRecord[] | undefined): Map<number, AudioRecord[]>;
export declare function chapterStale(chapter: StoredChapter | undefined, records: AudioRecord[] | undefined, downloadedAtMs: number): boolean;
export declare function withSources(chapter: StoredChapter, records: AudioRecord[]): StoredChapter;
