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
 * Roughly where a vertical feed draws over the video: its header at the top,
 * the title, caption and audio line along the bottom, and the like / comment /
 * share column on the right. Approximate on purpose -- the four feeds put these
 * in about the same places, and change them between app versions -- so this is
 * a guide for keeping the ayah clear, not a measurement.
 */
const VERTICAL_FEED: FrameArea[] = [
  { top: 0, left: 0, width: 100, height: 8 },
  { top: 78, left: 0, width: 100, height: 22 },
  { top: 40, left: 86, width: 14, height: 38 }
];

/** Where the platform's own interface covers the frame, or nothing for a feed that leaves the video clear. */
export function coveredAreas(presetId: string): FrameArea[] {
  const preset = EXPORT_PRESETS.find(p => p.id === presetId);
  return preset && preset.aspectRatio === '9:16' ? VERTICAL_FEED : [];
}
