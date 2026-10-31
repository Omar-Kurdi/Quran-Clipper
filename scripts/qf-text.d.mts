/** Types for qf-text.mjs, so its tests type-check. */

export interface SnapshotRecord { record_type?: string; [field: string]: unknown }
export interface Mutation { type: string; sequence?: number; resource_id?: number }

export declare const CORE: string;
export declare const MUSHAF: string;
export declare const SPELLING: string;
export declare const GLOSSES: string;
export declare const EDITIONS: string;
export declare function folderOf(resource: string): string;
export declare function surahFiles(resource: string, records: SnapshotRecord[], wordSurah: ((wordId: number) => number | null) | null): Map<number, unknown>;
export declare function editionsAfter(held: string[], mutations: Mutation[]): string[];
