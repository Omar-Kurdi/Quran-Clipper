import { describe, it, expect } from 'vitest';
import { phonemeTrialOffered, isPhonemeProvider, asLab, labStages, LAB_DEFAULTS } from './phonemeTrial';

describe('phonemeTrialOffered', () => {
  it('is offered only in a personal studio running in development', () => {
    expect(phonemeTrialOffered('personal', 'development')).toBe(true);
    expect(phonemeTrialOffered('personal', 'production')).toBe(false);
    expect(phonemeTrialOffered('public', 'development')).toBe(false);
    expect(phonemeTrialOffered('personal', undefined)).toBe(false);
  });
});

describe('isPhonemeProvider', () => {
  it('knows the lab and nothing else', () => {
    expect(isPhonemeProvider('phoneme-lab')).toBe(true);
    expect(isPhonemeProvider('align')).toBe(false);
  });
});

describe('asLab', () => {
  it('reads a lab setting from a request, and anything it does not know as the default', () => {
    expect(asLab(JSON.stringify({ reading: 'fastconformer', timing: 'old', starts: 'none', published: true })))
      .toEqual({ reading: 'fastconformer', timing: 'old', starts: 'none', published: true });
    expect(asLab(JSON.stringify({ reading: 'whisper', timing: 7 }))).toEqual(LAB_DEFAULTS);
    expect(asLab('not json')).toEqual(LAB_DEFAULTS);
    expect(asLab(undefined)).toEqual(LAB_DEFAULTS);
  });
});

describe('labStages', () => {
  it('names only the stages handed to a phoneme model', () => {
    expect(labStages({ ...LAB_DEFAULTS, reading: 'v31', timing: 'old' })).toBe('reading=v31;timing=old');
    expect(labStages({ ...LAB_DEFAULTS, reading: 'fastconformer', timing: 'fastconformer' })).toBe('');
  });
});
