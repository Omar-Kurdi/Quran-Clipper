/**
 * The phoneme re-timing trial: Match, with each word's start then moved to
 * where a phoneme-level Quran model hears it (FutureIdeas #58, the sidecar's
 * `phoneme.py`). Two matchers, one per model, so the same recording can be
 * matched with each and the exports compared by ear.
 *
 * Offered only in a personal studio running under `npm run dev`: the models
 * are gated downloads under a no-profit licence, and nothing yet says the
 * trial should leave development.
 */

import type { PhonemeRetime } from './forcedAligner';
import type { StudioMode } from './studioMode';

export const PHONEME_PROVIDERS = ['phoneme-v31', 'phoneme-old'] as const;
export type PhonemeProvider = typeof PHONEME_PROVIDERS[number];

export const isPhonemeProvider = (provider: string): provider is PhonemeProvider =>
  (PHONEME_PROVIDERS as readonly string[]).includes(provider);

/** The sidecar's name for each trial's model. */
export const PHONEME_MODEL: Record<PhonemeProvider, PhonemeRetime> = { 'phoneme-v31': 'v31', 'phoneme-old': 'old' };

/** Whether this studio offers the trial: personal, and in development. */
export function phonemeTrialOffered(mode: StudioMode, nodeEnv: string | undefined): boolean {
  return mode !== 'public' && nodeEnv === 'development';
}
