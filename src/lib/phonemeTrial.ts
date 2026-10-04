/**
 * The phoneme lab: Match, with each stage of it handed to whichever model is
 * chosen, so the phoneme models can be compared with fastconformer one stage
 * at a time and mixed where that helps (FutureIdeas #58, the sidecar's
 * `phoneme.py` and `phoneme_reading.py`).
 *
 * - reading: what was recited, restarts included
 * - timing: the word times the captions are cut from
 * - starts: the word starts Highlight and Reveal draw (every match re-times
 *   these with the older phoneme model by default)
 * - published: whether a built-in reciter's published timings are used, as
 *   Local uses them, or set aside so the models' own work is what shows
 *
 * Offered only in a personal studio running under `npm run dev`.
 */

import type { PhonemeRetime } from './forcedAligner';
import type { StudioMode } from './studioMode';

export const PHONEME_PROVIDERS = ['phoneme-lab'] as const;
export type PhonemeProvider = typeof PHONEME_PROVIDERS[number];

export const isPhonemeProvider = (provider: string): provider is PhonemeProvider =>
  (PHONEME_PROVIDERS as readonly string[]).includes(provider);

export const LAB_CHOICES = {
  reading: ['fastconformer', 'mixed', 'v31', 'best'],
  timing: ['fastconformer', 'old', 'v31'],
  starts: ['old', 'v31', 'none']
} as const;

export interface PhonemeLab {
  reading: typeof LAB_CHOICES.reading[number];
  timing: typeof LAB_CHOICES.timing[number];
  starts: PhonemeRetime;
  published: boolean;
}

/** Where the lab starts: the one stage worth trying first handed over, the rest as Local does it. */
export const LAB_DEFAULTS: PhonemeLab = { reading: 'mixed', timing: 'fastconformer', starts: 'old', published: false };

const pick = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? value as T : fallback;

/** A lab setting as it arrives in a request: anything it does not know is the default. */
export function asLab(value: unknown): PhonemeLab {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: the defaults.
  }
  return {
    reading: pick(raw.reading, LAB_CHOICES.reading, LAB_DEFAULTS.reading),
    timing: pick(raw.timing, LAB_CHOICES.timing, LAB_DEFAULTS.timing),
    starts: pick(raw.starts, LAB_CHOICES.starts, LAB_DEFAULTS.starts),
    published: typeof raw.published === 'boolean' ? raw.published : LAB_DEFAULTS.published
  };
}

/** The sidecar's `lab` field: the stages handed to a phoneme model, as `reading=v31;timing=old`. */
export function labStages(lab: PhonemeLab): string {
  return [
    lab.reading !== 'fastconformer' ? `reading=${lab.reading}` : '',
    lab.timing !== 'fastconformer' ? `timing=${lab.timing}` : ''
  ].filter(Boolean).join(';');
}

/** Whether this studio offers the lab: personal, and in development. */
export function phonemeTrialOffered(mode: StudioMode, nodeEnv: string | undefined): boolean {
  return mode !== 'public' && nodeEnv === 'development';
}
