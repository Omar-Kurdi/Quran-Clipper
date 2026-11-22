/**
 * The zoom a timeline opens at: the least at which nearly all its captions are
 * wide enough to read, so there is no more scrolling than reading them needs.
 */

/** How wide a caption must be to read: its ayah number and the start of its words. */
export const FIT_CAPTION_PX = 48;

/**
 * The least of `zooms` at which all but the shortest tenth of `lengths`
 * (captions, in seconds) are `FIT_CAPTION_PX` wide on a track `width` pixels
 * wide showing `span` seconds -- a one-word repeat should not zoom a whole
 * surah in. The greatest zoom when none is enough; null with no captions.
 */
export function fittingZoom(lengths: readonly number[], span: number, width: number, zooms: readonly number[]): number | null {
  if (!lengths.length || !(width > 0) || !(span > 0) || !zooms.length) return null;
  const sorted = [...lengths].sort((a, b) => a - b);
  const short = sorted[Math.floor(sorted.length * 0.1)];
  return zooms.find(level => (short / span) * level * width >= FIT_CAPTION_PX) ?? zooms[zooms.length - 1];
}
