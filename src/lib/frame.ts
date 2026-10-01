import { EXPORT_PRESETS, presetForAspect, type ExportPreset } from './exportPresets';

/**
 * Which platform the studio's frame is shaped for.
 *
 * The frame is one decision, made above the preview and read again by Export.
 * A shape alone cannot say which platform it is for -- Shorts, TikTok, Reels
 * and Facebook Reels are all 9:16 -- so the chosen platform is remembered as
 * well. It stands only while its shape is still the studio's: a project opened
 * in another shape answers with the first platform that wants that shape.
 */
export function framePreset(chosenIndex: number, aspectRatio: string): ExportPreset {
  const chosen = EXPORT_PRESETS[chosenIndex];
  return chosen && chosen.aspectRatio === aspectRatio ? chosen : presetForAspect(aspectRatio);
}

/** A part of the frame, in percent of its width and height. */
export interface FrameArea {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where each vertical feed draws its own interface over a 1080×1920 video, as
 * margins in px: its header along the top, the title, caption and audio line
 * along the bottom, the like / comment / share column down the right, and a
 * strip on the left. Each edge is the larger of two published guides
 * (postplanify.com and the figures gathered at upload-post.com / brandeal.ai,
 * checked 2026-10-01), so the outline errs towards covering more. The apps
 * move these between versions: a guide for keeping the ayah clear, not a
 * measurement.
 */
const FEED_MARGINS: Record<string, { top: number; bottom: number; left: number; right: number }> = {
  shorts: { top: 120, bottom: 320, left: 60, right: 180 },
  tiktok: { top: 150, bottom: 480, left: 60, right: 140 },
  reels: { top: 220, bottom: 420, left: 60, right: 130 },
  facebook: { top: 100, bottom: 300, left: 0, right: 60 }
};

const pct = (px: number, of: number) => Math.round((px / of) * 1000) / 10;

/** Where the platform's own interface covers the frame, or nothing for a feed that leaves the video clear. */
export function coveredAreas(presetId: string): FrameArea[] {
  const m = FEED_MARGINS[presetId];
  if (!m) return [];
  const top = pct(m.top, 1920);
  const bottom = pct(m.bottom, 1920);
  const middle = Math.round((100 - top - bottom) * 10) / 10;
  const areas: FrameArea[] = [
    { top: 0, left: 0, width: 100, height: top },
    { top: 100 - bottom, left: 0, width: 100, height: bottom },
    { top, left: 100 - pct(m.right, 1080), width: pct(m.right, 1080), height: middle }
  ];
  if (m.left > 0) areas.push({ top, left: 0, width: pct(m.left, 1080), height: middle });
  return areas;
}
