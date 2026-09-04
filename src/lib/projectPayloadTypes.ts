/**
 * The shapes `buildProjectPayload` needs, without importing the studio's
 * component tree into a module a test has to load.
 */
export type { VerseData } from '@/lib/quranData';

/**
 * Every styling field is stored verbatim, so this is deliberately open: adding
 * a knob to the canvas should not need a second edit here to make it persist.
 */
export type VideoCanvasConfigLike = Record<string, unknown>;
