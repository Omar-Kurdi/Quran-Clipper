/**
 * Whole looks, applied in one click.
 *
 * The palette switcher in the header themes the *studio*; these style the
 * *video*: the Arabic face, the colours of the text and accents, the card, the
 * background and how it is dimmed. A preset is a named bundle of those, and
 * applying one is a single styling edit -- undoable like any other.
 *
 * What a preset never touches is the project's content and format: which
 * translations are shown, the badge and watermark text, the aspect ratio, the
 * frame rate. A look applied to a finished 16:9 project must not turn it into
 * a vertical one, and must not drop the second language someone chose.
 *
 * Code rather than the `preset_templates` table, so every preset works on a
 * studio with no database -- which is the default setup.
 */

import { BACKGROUND_VIDEOS } from './quranData';
import { QPC_V2 } from './mushafFonts';
import type { VideoCanvasConfig } from '@/components/VideoCanvas';
import { asFrameLayout, type FrameLayoutId } from './frameLayout';
import { asBadgeStyle, type BadgeStyle } from './surahBadge';

/** The fields a preset sets. Everything else in the config is left as it was. */
export type PresetLook = Pick<
  VideoCanvasConfig,
  | 'fontArabic'
  | 'arabicFontSize'
  | 'translationFontSize'
  | 'ayahNumberFontSize'
  | 'textAlignment'
  | 'textColor'
  | 'accentColor'
  | 'translationColor'
  | 'textShadow'
  | 'showWaveform'
  | 'showSurahBadge'
  | 'badgeStyle'
  | 'layout'
  | 'bgOverlayOpacity'
  | 'bgBlur'
  | 'cardBgOpacity'
  | 'cardBorder'
> & {
  badgeStyle: BadgeStyle;
  layout: FrameLayoutId;
  /** A stock background, by its id in `BACKGROUND_VIDEOS`. */
  background: string;
};

export interface StylePreset {
  /** Stable, and the key for the preset's name and note in the dictionary. */
  id: string;
  look: PresetLook;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    // The studio's own defaults, so there is always a way back to them.
    id: 'night-mosque',
    look: {
      layout: 'card',
      badgeStyle: 'pill',
      background: 'mosque-moon',
      fontArabic: QPC_V2,
      arabicFontSize: 45,
      translationFontSize: 45,
      ayahNumberFontSize: 50,
      textAlignment: 'center',
      textColor: '#ffffff',
      accentColor: '#b8c7dc',
      translationColor: '#d5dfec',
      textShadow: true,
      showWaveform: true,
      showSurahBadge: true,
      bgOverlayOpacity: 40,
      bgBlur: 0,
      cardBgOpacity: 30,
      cardBorder: true
    }
  },
  {
    id: 'gold-kaaba',
    look: {
      layout: 'card',
      badgeStyle: 'frame',
      background: 'kaaba-pilgrims',
      fontArabic: QPC_V2,
      arabicFontSize: 48,
      translationFontSize: 40,
      ayahNumberFontSize: 50,
      textAlignment: 'center',
      textColor: '#fdf6e3',
      accentColor: '#d4af37',
      translationColor: '#efe3c2',
      textShadow: true,
      showWaveform: false,
      showSurahBadge: true,
      bgOverlayOpacity: 55,
      bgBlur: 2,
      cardBgOpacity: 25,
      cardBorder: true
    }
  },
  {
    id: 'starlight',
    look: {
      layout: 'lower-third',
      badgeStyle: 'pill',
      background: 'starry-sky',
      fontArabic: 'DigitalKhatt',
      arabicFontSize: 46,
      translationFontSize: 42,
      ayahNumberFontSize: 46,
      textAlignment: 'center',
      textColor: '#f1f5ff',
      accentColor: '#9db4ff',
      translationColor: '#c9d6ff',
      textShadow: true,
      showWaveform: true,
      showSurahBadge: true,
      bgOverlayOpacity: 30,
      bgBlur: 0,
      cardBgOpacity: 0,
      cardBorder: false
    }
  },
  {
    // No card and a soft blur: the words sit on the picture itself.
    id: 'minimal',
    look: {
      layout: 'open',
      badgeStyle: 'pill',
      background: 'clouds-night',
      fontArabic: QPC_V2,
      arabicFontSize: 50,
      translationFontSize: 38,
      ayahNumberFontSize: 44,
      textAlignment: 'center',
      textColor: '#ffffff',
      accentColor: '#e2e8f0',
      translationColor: '#e2e8f0',
      textShadow: true,
      showWaveform: false,
      showSurahBadge: false,
      bgOverlayOpacity: 50,
      bgBlur: 6,
      cardBgOpacity: 0,
      cardBorder: false
    }
  },
  {
    id: 'madinah-green',
    look: {
      layout: 'split',
      badgeStyle: 'calligraphic',
      background: 'prophet-mosque',
      fontArabic: QPC_V2,
      arabicFontSize: 46,
      translationFontSize: 42,
      ayahNumberFontSize: 50,
      textAlignment: 'center',
      textColor: '#ffffff',
      accentColor: '#6fcf97',
      translationColor: '#d7f5e3',
      textShadow: true,
      showWaveform: true,
      showSurahBadge: true,
      bgOverlayOpacity: 45,
      bgBlur: 0,
      cardBgOpacity: 40,
      cardBorder: true
    }
  },
  {
    id: 'indopak',
    look: {
      layout: 'top',
      badgeStyle: 'corner',
      background: 'minaret-moonlit',
      fontArabic: 'IndopakNastaleeq',
      arabicFontSize: 44,
      translationFontSize: 40,
      ayahNumberFontSize: 46,
      textAlignment: 'center',
      textColor: '#fffaf0',
      accentColor: '#f0b86e',
      translationColor: '#f5e6cc',
      textShadow: true,
      showWaveform: true,
      showSurahBadge: true,
      bgOverlayOpacity: 50,
      bgBlur: 0,
      cardBgOpacity: 35,
      cardBorder: true
    }
  }
];

/** A stock background by id, or undefined when the library no longer has it. */
export const presetBackground = (id: string) => BACKGROUND_VIDEOS.find(video => video.id === id);

/**
 * The config with `preset`'s look applied.
 *
 * The background replaces a hand-built background arrangement too -- a look
 * is its picture as much as its colours -- and the edit is undoable, so the
 * arrangement is one step back. A preset whose stock background has left the
 * library keeps the current one rather than blanking the frame.
 */
export function applyStylePreset<C extends VideoCanvasConfig>(config: C, preset: StylePreset): C {
  const { background, ...look } = preset.look;
  const video = presetBackground(background);
  return {
    ...config,
    ...look,
    ...(video ? { bgType: 'video', bgUrl: video.url, bgMode: 'single' as const } : {})
  };
}

/** Which preset the config currently matches exactly, if any, so the gallery can mark it. */
export function matchingPreset(config: VideoCanvasConfig): string | null {
  const match = STYLE_PRESETS.find(({ look }) => {
    const { background, ...rest } = look;
    // A project from before layouts and badge styles has neither, and reads as
    // the card and the pill -- so it still matches a preset that names them.
    const current = { ...config, layout: asFrameLayout(config.layout), badgeStyle: asBadgeStyle(config.badgeStyle) };
    const sameLook = (Object.keys(rest) as (keyof typeof rest)[]).every(key => current[key] === rest[key]);
    return sameLook && config.bgUrl === presetBackground(background)?.url;
  });
  return match?.id ?? null;
}
