/**
 * The front page's demonstration: Al-Mulk 67:1-2 by Abdul Rahman Al-Sudais,
 * the passage the READMEs' demos use, captioned as the studio captions it.
 *
 * The recording is the Quran Foundation's two ayah files laid end to end, as
 * the studio plays them; word times are the studio's Load + Match on it. The
 * translation is Saheeh International, the studio's default. The waveform is
 * the recording's own loudness over these twenty seconds, 120 bars, measured
 * once and kept here so the page draws it without fetching the audio.
 */

export const DEMO_AUDIO_URL = '/api/audio/ayahs?reciter=qf-3&surah=67&start=1&end=2';

export interface DemoCaption {
  verseKey: string;
  ayah: number;
  start: number;
  end: number;
  /** Each word, its glyph on the mushaf page, and when it begins, in seconds. */
  words: { text: string; glyph: string; at: number }[];
  /** The ayah's end medallion, a glyph of the same page. */
  endGlyph: string;
  translation: string;
}

export const DEMO_CAPTIONS: DemoCaption[] = [
  {
    verseKey: '67:1',
    ayah: 1,
    endGlyph: '\ufc4a',
    start: 0,
    end: 8.12,
    words: [
      { text: 'تَبَـٰرَكَ', glyph: '\ufc41', at: 0 },
      { text: 'ٱلَّذِى', glyph: '\ufc42', at: 1.23 },
      { text: 'بِيَدِهِ', glyph: '\ufc43', at: 2.05 },
      { text: 'ٱلْمُلْكُ', glyph: '\ufc44', at: 2.8 },
      { text: 'وَهُوَ', glyph: '\ufc45', at: 3.69 },
      { text: 'عَلَىٰ', glyph: '\ufc46', at: 4.2 },
      { text: 'كُلِّ', glyph: '\ufc47', at: 4.79 },
      { text: 'شَىْءٍ', glyph: '\ufc48', at: 5.4 },
      { text: 'قَدِيرٌ', glyph: '\ufc49', at: 6.51 },
    ],
    translation: 'Blessed is He in whose hand is dominion, and He is over all things competent.',
  },
  {
    verseKey: '67:2',
    ayah: 2,
    endGlyph: '\ufc57',
    start: 8.12,
    end: 19.9,
    words: [
      { text: 'ٱلَّذِى', glyph: '\ufc4b', at: 8.12 },
      { text: 'خَلَقَ', glyph: '\ufc4c', at: 9.09 },
      { text: 'ٱلْمَوْتَ', glyph: '\ufc4d', at: 9.73 },
      { text: 'وَٱلْحَيَوٰةَ', glyph: '\ufc4e', at: 10.54 },
      { text: 'لِيَبْلُوَكُمْ', glyph: '\ufc4f', at: 11.68 },
      { text: 'أَيُّكُمْ', glyph: '\ufc50', at: 13.01 },
      { text: 'أَحْسَنُ', glyph: '\ufc51', at: 14.01 },
      { text: 'عَمَلًا ۚ', glyph: '\ufc52\ufc53', at: 14.71 },
      { text: 'وَهُوَ', glyph: '\ufc54', at: 16.08 },
      { text: 'ٱلْعَزِيزُ', glyph: '\ufc55', at: 16.61 },
      { text: 'ٱلْغَفُورُ', glyph: '\ufc56', at: 17.67 },
    ],
    translation: '[He] who created death and life to test you [as to] which of you is best in deed — and He is the Exalted in Might, the Forgiving.',
  },
];

export const DEMO_LENGTH = 19.9;

/**
 * The page of the Madani mushaf both ayahs are printed on, drawn from its own
 * font as the studio's default "Madani Mushaf" face draws it: one glyph per
 * word (`code_v2`), the ayah's end medallion included. See `mushafFonts.ts`.
 */
export const DEMO_PAGE = 562;

export const DEMO_WAVEFORM = [
  0.24, 0.03, 0.19, 0.51, 0.74, 0.5, 0.23, 0.35, 0.33, 0.45, 0.34, 0.36, 0.3, 0.49, 0.44, 0.42, 0.44, 0.35, 0.39, 0.38,
  0.34, 0.36, 0.5, 0.4, 0.52, 0.64, 0.6, 0.63, 0.73, 0.32, 0.41, 0.35, 0.37, 0.54, 0.5, 0.49, 0.5, 0.43, 0.43, 0.25,
  0.67, 0.41, 0.51, 0.6, 0.65, 0.75, 0.42, 0.14, 0.09, 0.07, 0.74, 0.36, 0.56, 0.39, 0.55, 0.48, 0.67, 0.48, 0.54, 0.37,
  0.54, 0.55, 0.51, 0.86, 0.52, 0.31, 0.57, 0.65, 0.61, 0.28, 0.42, 0.49, 0.49, 0.55, 0.43, 0.69, 0.31, 0.47, 0.3, 0.56,
  0.41, 0.46, 0.42, 0.53, 0.35, 0.37, 0.14, 0.6, 0.64, 0.68, 0.5, 0.55, 0.68, 1.0, 0.43, 0.16, 0.1, 0.28, 0.36, 0.67,
  0.57, 0.52, 0.53, 0.41, 0.51, 0.43, 0.48, 0.44, 0.55, 0.33, 0.46, 0.42, 0.47, 0.58, 0.68, 0.66, 0.6, 0.33, 0.14, 0.07,
];

/** The caption on screen at `t` seconds, and how many of its words have begun. */
export function captionAt(t: number): { caption: DemoCaption; spoken: number } {
  const caption = DEMO_CAPTIONS.find(c => t < c.end) ?? DEMO_CAPTIONS[DEMO_CAPTIONS.length - 1];
  return { caption, spoken: caption.words.filter(w => w.at <= t).length };
}
