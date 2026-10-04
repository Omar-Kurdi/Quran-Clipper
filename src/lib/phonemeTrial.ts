/**
 * Every match moves each word's start to where a phoneme-level Quran model
 * hears it -- the sidecar's default model (`phoneme.py`, FutureIdeas #58).
 * These two matchers are its alternatives, for comparing by ear: the other
 * phoneme model, and fastconformer's own times with no re-timing at all.
 *
 * Offered only in a personal studio running under `npm run dev`; nobody else
 * has anything to choose between.
 */

import type { PhonemeRetime } from './forcedAligner';
import type { StudioMode } from './studioMode';

export const PHONEME_PROVIDERS = ['phoneme-v31', 'phoneme-off'] as const;
export type PhonemeProvider = typeof PHONEME_PROVIDERS[number];

export const isPhonemeProvider = (provider: string): provider is PhonemeProvider =>
  (PHONEME_PROVIDERS as readonly string[]).includes(provider);

/** What each asks the sidecar to re-time with, in place of its default. */
export const PHONEME_MODEL: Record<PhonemeProvider, PhonemeRetime> = { 'phoneme-v31': 'v31', 'phoneme-off': 'none' };

/** Whether this studio offers the trial: personal, and in development. */
export function phonemeTrialOffered(mode: StudioMode, nodeEnv: string | undefined): boolean {
  return mode !== 'public' && nodeEnv === 'development';
}
