/** The most the trim dialog's corner grip scales it, and the least. */
export const PANEL_SCALE_MAX = 2;
export const PANEL_SCALE_MIN = 0.6;

/**
 * The largest scale a panel of `natural` size (as drawn at scale 1) can be
 * drawn at and still fit the viewport -- 96% of its width, 90% of its height,
 * the dialog's own bounds -- never past the grip's limit, and never below the
 * size it is drawn at by default.
 */
export function fittedScale(natural: { width: number; height: number }, viewport: { width: number; height: number }): number {
  if (!(natural.width > 0) || !(natural.height > 0)) return 1;
  const fit = Math.min((viewport.width * 0.96) / natural.width, (viewport.height * 0.9) / natural.height);
  return Math.floor(Math.max(1, Math.min(PANEL_SCALE_MAX, fit)) * 100) / 100;
}
