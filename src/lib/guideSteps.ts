import type { StaticImageData } from 'next/image';
import type { Dictionary } from './i18n.en';
import type { Locale } from './i18n';
import enPassage from '@/assets/guide/en-passage.webp';
import enPassageStill from '@/assets/guide/en-passage-still.webp';
import arPassage from '@/assets/guide/ar-passage.webp';
import arPassageStill from '@/assets/guide/ar-passage-still.webp';
import enCaptions from '@/assets/guide/en-captions.webp';
import enCaptionsStill from '@/assets/guide/en-captions-still.webp';
import arCaptions from '@/assets/guide/ar-captions.webp';
import arCaptionsStill from '@/assets/guide/ar-captions-still.webp';
import enStyle from '@/assets/guide/en-style.webp';
import enStyleStill from '@/assets/guide/en-style-still.webp';
import arStyle from '@/assets/guide/ar-style.webp';
import arStyleStill from '@/assets/guide/ar-style-still.webp';
import enExporting from '@/assets/guide/en-export.webp';
import enExportingStill from '@/assets/guide/en-export-still.webp';
import arExporting from '@/assets/guide/ar-export.webp';
import arExportingStill from '@/assets/guide/ar-export-still.webp';

/** The guide's plain sentences, not its formatted ones. */
type GuideText = { [K in keyof Dictionary['guide']]: Dictionary['guide'][K] extends string ? K : never }[keyof Dictionary['guide']];

/** A card's clip in one language: the moving one, and its last frame for reduced motion. */
export interface GuideMedia {
  animated: StaticImageData;
  still: StaticImageData;
}

export interface GuideStep {
  title: GuideText;
  body: GuideText;
  media: Partial<Record<Locale, GuideMedia>>;
}

/**
 * The welcome guide's cards, in the order the work goes, each with a clip of
 * the studio in each language. The clips are recorded from a production build
 * in public mode (`docs/MEDIA.md`).
 */
export const GUIDE_STEPS: GuideStep[] = [
  { title: 'passageTitle', body: 'passageBody', media: { en: { animated: enPassage, still: enPassageStill }, ar: { animated: arPassage, still: arPassageStill } } },
  { title: 'captionsTitle', body: 'captionsBody', media: { en: { animated: enCaptions, still: enCaptionsStill }, ar: { animated: arCaptions, still: arCaptionsStill } } },
  { title: 'styleTitle', body: 'styleBody', media: { en: { animated: enStyle, still: enStyleStill }, ar: { animated: arStyle, still: arStyleStill } } },
  { title: 'exportTitle', body: 'exportBody', media: { en: { animated: enExporting, still: enExportingStill }, ar: { animated: arExporting, still: arExportingStill } } }
];
