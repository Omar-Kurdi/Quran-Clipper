/** Types for `qul-themes.mjs`, for the tests that import it. */
export declare const QUL_DIR: string;
export declare function themesBySurah(
  rows: { surah: number; from: number; to: number; theme: string }[]
): Record<number, [number, number, string][]>;
