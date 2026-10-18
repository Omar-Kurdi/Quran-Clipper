/** Types for qf-chapter-plan.mjs, so its tests type-check. */

export interface Frame { offset: number; size: number }
export interface Verse { ayah: number; words: string[] }
export interface Window { first: number; keep: number; last: number; from: number; to: number; final: boolean }
export interface AlignedWord { verse_key: string; word_index: number; start: number; end: number }
export interface Join { at: number; from?: number; until?: number; depth: number; overFloor: number; heard: boolean }
export interface CheckedJoin extends Join { ayah: number; qf: boolean; confirmed?: boolean; contradicted?: boolean; manual?: boolean; tangled?: boolean; opening?: boolean; secondCut?: number; qfInVoice?: boolean; qfGap?: number | null; qfStart?: number | null }
export interface AyahTiming { timestamp_from: number; timestamp_to: number; segments?: (number | string)[][] }
export interface ChapterRecord { record_type: string; chapter_id?: number | string | null; audio_url?: string; file_size?: number | string; updated_at?: string | null }
export interface FreshChapter { file: ChapterRecord | null; ayahs: ChapterRecord[] }
export interface CutSource { url: string; size: number; updatedAt?: string | null; cutAt: string }

export declare function mp3Frames(bytes: Uint8Array): { frames: Frame[]; rate: number; samples: number; variable: boolean };
export declare function frameAt(seconds: number, rate: number, samples: number): number;
export declare function framesMs(count: number, rate: number, samples: number): number;
export declare function levels(pcm: ArrayLike<number>, rate: number, hop?: number, scale?: number): Float32Array;
export declare function speechLevel(db: ArrayLike<number>): number;
export declare function chapterPace(verses: Verse[], duration: number): number;
export declare function nextWindow(input: { verses: Verse[]; first: number; from: number; duration: number; pace: number; stretch?: number }): Window;
export declare function ayahBounds(words: AlignedWord[], offset?: number): Map<number, { start: number; end: number }>;
export declare const PAUSE_DEPTH_DB: number;
export declare function inPause(join: Join): boolean;
export declare function mergedSilences(silences: [number, number][] | undefined): [number, number][];
interface Levels { db: Float32Array; silences: [number, number][]; hop?: number }
export declare function joinCut(input: Levels & { after: number; nextStart: number }): Join;
export declare function manualCut(input: Levels & { at: number; after?: number }): Join;
export declare function afterOpening(input: Levels & { openingStart?: number; openingEnd: number; firstStart: number }): Join;
export declare function qfAgrees(join: number | { at: number; from?: number; until?: number }, before: Partial<AyahTiming> | undefined, after: Partial<AyahTiming> | undefined): boolean;
export declare const MIN_AGREEMENT: number;
export declare const MIN_AYAH_SEC: number;
export declare function chapterProblems(placed: {
  windows: { from: number; to: number; agreement: number | null }[];
  joins: CheckedJoin[];
  cuts: number[];
  duration: number;
  db?: Float32Array | null;
  hop?: number;
}): string[];
export declare function qfWordsFit(joins: CheckedJoin[]): boolean;
export declare function ayahSegments(input: { fromMs: number; ms: number; qf: AyahTiming | null | undefined; words: AlignedWord[] | undefined }): number[][];
export declare function chapterRecordsBySurah(records: ChapterRecord[] | undefined): Map<number, FreshChapter>;
export declare function cutStale(chapter: { source?: CutSource } | null | undefined, fresh: FreshChapter | undefined): boolean;
export declare const SEPARATE_LETTERS: Set<string>;
export declare const QF_NARROW_SEC: number;
export declare function qfGap(before: Partial<AyahTiming> | undefined, after: Partial<AyahTiming> | undefined): number | null;
