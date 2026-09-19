import { describe, it, expect } from 'vitest';
import { STYLE_PRESETS, applyStylePreset, matchingPreset, presetBackground } from './stylePresets';
import { FONTS_ARABIC } from './quranData';
import type { VideoCanvasConfig } from '@/components/VideoCanvas';

/** A finished project: 16:9, two languages, its own badge and watermark, a custom background lane. */
const project: VideoCanvasConfig = {
  aspectRatio: '16:9',
  fontArabic: 'DigitalKhatt',
  fontTranslation: 'Inter',
  arabicFontSize: 30,
  translationFontSize: 30,
  ayahNumberFontSize: 30,
  textAlignment: 'right',
  textColor: '#000000',
  accentColor: '#000000',
  translationColor: '#000000',
  textShadow: false,
  showTranslation: true,
  translationIds: ['20', '85'],
  translationFollowsWords: true,
  showWaveform: false,
  showSurahBadge: false,
  surahBadgeText: 'My badge',
  surahBadgeSubtitleText: 'Sub',
  bgType: 'image',
  bgUrl: 'qcbg:bg_a',
  bgUrls: ['qcbg:bg_a', 'qcbg:bg_b'],
  bgMode: 'custom',
  bgSegments: [{ url: 'qcbg:bg_a', start: 0, end: 5 }],
  bgCycleSeconds: 5,
  bgOverlayOpacity: 10,
  bgBlur: 0,
  cardBgOpacity: 80,
  cardBorder: false,
  watermarkText: 'mine',
  watermarkPosition: 'top-left',
  fps: 30,
  gpuAccelerated: true
};

describe('STYLE_PRESETS', () => {
  it('names only fonts and backgrounds the studio has', () => {
    for (const { id, look } of STYLE_PRESETS) {
      expect(FONTS_ARABIC.some(font => font.id === look.fontArabic), id).toBe(true);
      expect(presetBackground(look.background), id).toBeDefined();
    }
  });

  it('has unique ids', () => {
    expect(new Set(STYLE_PRESETS.map(preset => preset.id)).size).toBe(STYLE_PRESETS.length);
  });
});

describe('applyStylePreset', () => {
  const preset = STYLE_PRESETS[1];
  const applied = applyStylePreset(project, preset);

  it('applies the whole look, background included', () => {
    expect(applied.fontArabic).toBe(preset.look.fontArabic);
    expect(applied.accentColor).toBe(preset.look.accentColor);
    expect(applied.cardBgOpacity).toBe(preset.look.cardBgOpacity);
    expect(applied.bgType).toBe('video');
    expect(applied.bgUrl).toBe(presetBackground(preset.look.background)?.url);
    expect(applied.bgMode).toBe('single');
  });

  it('leaves the content and format alone', () => {
    // A look must not reshape a finished project or drop its choices.
    expect(applied.aspectRatio).toBe('16:9');
    expect(applied.fps).toBe(30);
    expect(applied.translationIds).toEqual(['20', '85']);
    expect(applied.translationFollowsWords).toBe(true);
    expect(applied.surahBadgeText).toBe('My badge');
    expect(applied.watermarkText).toBe('mine');
    expect(applied.watermarkPosition).toBe('top-left');
    // The hand-built lane is kept, one undo away, just not in use.
    expect(applied.bgSegments).toEqual(project.bgSegments);
  });

  it('is recognised as the preset it came from', () => {
    expect(matchingPreset(project)).toBeNull();
    expect(matchingPreset(applied)).toBe(preset.id);
  });
});
