/**
 * The part of a built-in reciter's recording that is the clip.
 *
 * A reciter's audio is the whole chapter, so a passage from ayah 3 starts a
 * minute or more into the file. The export already rendered only the passage
 * (`exportRangeFor`), but the timeline was drawn from 0:00 and playback began
 * there: ayahs 1-2 played first, under ayah 3's caption, with the passage a
 * sliver at one end of the lane. Nothing had been trimmed, as far as anyone
 * looking could tell.
 *
 * So the timeline shows the clip, with a little of the recording either side
 * to drag an ayah's edge into, and playback runs from the clip's first ayah to
 * its last. An upload has no window: the file is the clip, and the trim is how
 * it was cut.
 */

export interface ClipWindow {
  start: number;
  end: number;
}

/** Recording either side of the clip the timeline still shows, so an edge can be dragged outwards. */
export const VIEW_MARGIN_SEC = 2;

/** The clip inside the recording, or null when the recording is the clip. */
export function clipWindow(range: { start: number; end: number }, fileDuration: number, isUpload: boolean): ClipWindow | null {
  if (isUpload || !(range.end > range.start)) return null;
  const whole = range.start <= 0.05 && (!(fileDuration > 0) || range.end >= fileDuration - 0.05);
  return whole ? null : { start: range.start, end: range.end };
}

/** What the timeline draws: the clip and its margins, inside the recording. */
export function timelineView(clip: ClipWindow | null, fileDuration: number): ClipWindow | null {
  if (!clip) return null;
  const last = Math.max(fileDuration > 0 ? fileDuration : 0, clip.end);
  return { start: Math.max(0, clip.start - VIEW_MARGIN_SEC), end: Math.min(last, clip.end + VIEW_MARGIN_SEC) };
}

/**
 * Where pressing play should start from: the clip's first ayah when the
 * playhead is outside the clip, or null to play on from where it is.
 */
export function playFrom(currentTime: number, clip: ClipWindow | null): number | null {
  if (!clip) return null;
  return currentTime < clip.start - 0.05 || currentTime >= clip.end - 0.05 ? clip.start : null;
}

/** Whether playback has run past the clip's last ayah and should stop. */
export function pastClipEnd(currentTime: number, clip: ClipWindow | null): boolean {
  return !!clip && currentTime >= clip.end;
}
