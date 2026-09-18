/**
 * How old stored Quran content may get before it is checked again.
 *
 * Its own module, with nothing imported, so the studio can ask the question
 * of its auto-saved draft without pulling the server-side sync -- and the file
 * reader behind local translations -- into the browser bundle.
 */

/** Seven days, the most the Quran Foundation allows stored content to go unchecked. */
export const CONTENT_SYNC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** True when content last checked at `syncedAt` must be checked again. */
export function needsContentSync(syncedAt: Date | string | number | null | undefined, now = Date.now()): boolean {
  if (syncedAt === null || syncedAt === undefined || syncedAt === '') return true;
  const at = new Date(syncedAt).getTime();
  return !Number.isFinite(at) || now - at >= CONTENT_SYNC_MAX_AGE_MS;
}
