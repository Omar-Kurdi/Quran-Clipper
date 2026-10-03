import { describe, it, expect } from 'vitest';
import { phonemeTrialOffered, isPhonemeProvider } from './phonemeTrial';

describe('phonemeTrialOffered', () => {
  it('is offered only in a personal studio running in development', () => {
    expect(phonemeTrialOffered('personal', 'development')).toBe(true);
    expect(phonemeTrialOffered('personal', 'production')).toBe(false);
    expect(phonemeTrialOffered('public', 'development')).toBe(false);
    expect(phonemeTrialOffered('personal', undefined)).toBe(false);
  });
});

describe('isPhonemeProvider', () => {
  it('knows the two trial matchers and nothing else', () => {
    expect(isPhonemeProvider('phoneme-v31')).toBe(true);
    expect(isPhonemeProvider('phoneme-old')).toBe(true);
    expect(isPhonemeProvider('align')).toBe(false);
  });
});
