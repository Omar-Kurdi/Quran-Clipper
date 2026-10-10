/**
 * The landing page's demonstration: Al-Mulk 67:1-2 by Abdul Rahman Al-Sudais,
 * the passage the READMEs' demos use, captioned as the studio captions it.
 *
 * Word times are quran.com's published timings for this recording (reciter 3,
 * chapter 67), the same ones the studio loads; the translation is Saheeh
 * International, the studio's default. The waveform is the recording's own
 * loudness over these twenty seconds, 120 bars, measured once and kept here so
 * the page draws it without fetching the audio.
 */

export const DEMO_AUDIO_URL =
  `/api/audio/proxy?url=${encodeURIComponent('https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/67.mp3')}`;

export interface DemoCaption {
  verseKey: string;
  ayah: number;
  start: number;
  end: number;
  /** Each word and when it begins, in seconds. */
  words: { text: string; at: number }[];
  translation: string;
}

export const DEMO_CAPTIONS: DemoCaption[] = [
  {
    verseKey: '67:1',
    ayah: 1,
    start: 0,
    end: 8.12,
    words: [
      { text: 'تَبَـٰرَكَ', at: 0 },
      { text: 'ٱلَّذِى', at: 1.16 },
      { text: 'بِيَدِهِ', at: 1.99 },
      { text: 'ٱلْمُلْكُ', at: 2.77 },
      { text: 'وَهُوَ', at: 3.66 },
      { text: 'عَلَىٰ', at: 4.19 },
      { text: 'كُلِّ', at: 4.79 },
      { text: 'شَىْءٍ', at: 5.38 },
      { text: 'قَدِيرٌ', at: 6.47 },
    ],
    translation: 'Blessed is He in whose hand is dominion, and He is over all things competent.',
  },
  {
    verseKey: '67:2',
    ayah: 2,
    start: 8.12,
    end: 19.9,
    words: [
      { text: 'ٱلَّذِى', at: 8.12 },
      { text: 'خَلَقَ', at: 9.04 },
      { text: 'ٱلْمَوْتَ', at: 9.66 },
      { text: 'وَٱلْحَيَوٰةَ', at: 10.47 },
      { text: 'لِيَبْلُوَكُمْ', at: 11.63 },
      { text: 'أَيُّكُمْ', at: 12.96 },
      { text: 'أَحْسَنُ', at: 13.95 },
      { text: 'عَمَلًا ۚ', at: 14.69 },
      { text: 'وَهُوَ', at: 15.56 },
      { text: 'ٱلْعَزِيزُ', at: 16.55 },
      { text: 'ٱلْغَفُورُ', at: 17.64 },
    ],
    translation: '[He] who created death and life to test you [as to] which of you is best in deed — and He is the Exalted in Might, the Forgiving.',
  },
];

export const DEMO_LENGTH = 20.2;

export const DEMO_WAVEFORM = [
  0.27, 0.05, 0.23, 0.6, 0.8, 0.54, 0.26, 0.38, 0.38, 0.5, 0.37, 0.38, 0.35, 0.57, 0.45, 0.48, 0.45, 0.4, 0.44, 0.42,
  0.28, 0.51, 0.51, 0.49, 0.67, 0.62, 0.63, 0.85, 0.65, 0.39, 0.37, 0.41, 0.37, 0.65, 0.55, 0.59, 0.49, 0.47, 0.4, 0.66,
  0.44, 0.53, 0.63, 0.69, 0.82, 0.63, 0.2, 0.11, 0.07, 0.58, 0.66, 0.56, 0.5, 0.57, 0.47, 0.77, 0.61, 0.58, 0.41, 0.56,
  0.64, 0.53, 0.94, 0.61, 0.35, 0.63, 0.72, 0.67, 0.31, 0.47, 0.55, 0.53, 0.58, 0.5, 0.74, 0.42, 0.48, 0.39, 0.59, 0.47,
  0.44, 0.6, 0.48, 0.46, 0.27, 0.45, 0.58, 0.76, 0.71, 0.55, 0.55, 1.0, 0.94, 0.22, 0.15, 0.15, 0.31, 0.57, 0.77, 0.57,
  0.61, 0.43, 0.53, 0.54, 0.51, 0.49, 0.56, 0.39, 0.53, 0.46, 0.48, 0.59, 0.74, 0.74, 0.7, 0.45, 0.18, 0.1, 0.05, 0.3,
];

/** The caption on screen at `t` seconds, and how many of its words have begun. */
export function captionAt(t: number): { caption: DemoCaption; spoken: number } {
  const caption = DEMO_CAPTIONS.find(c => t < c.end) ?? DEMO_CAPTIONS[DEMO_CAPTIONS.length - 1];
  return { caption, spoken: caption.words.filter(w => w.at <= t).length };
}
