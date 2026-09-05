import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { quranApiConfigured, quranApiSource, defaultTranslationId } from './quranApi';

const KEYS = [
  'QURAN_FOUNDATION_CLIENT_ID',
  'QURAN_FOUNDATION_CLIENT_SECRET',
  'QURAN_TRANSLATION_ID',
  'NEXT_PUBLIC_QURAN_TRANSLATION_ID'
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('which Quran API answers', () => {
  it('uses the open API when no credentials are set', () => {
    expect(quranApiConfigured()).toBe(false);
    expect(quranApiSource()).toBe('public');
  });

  it('needs both halves of a credential, not one', () => {
    process.env.QURAN_FOUNDATION_CLIENT_ID = 'abc';
    expect(quranApiConfigured()).toBe(false);
    process.env.QURAN_FOUNDATION_CLIENT_SECRET = 'shh';
    expect(quranApiConfigured()).toBe(true);
    expect(quranApiSource()).toBe('foundation');
  });

  it('ignores whitespace left by a copied-and-pasted secret', () => {
    process.env.QURAN_FOUNDATION_CLIENT_ID = '  ';
    process.env.QURAN_FOUNDATION_CLIENT_SECRET = '  ';
    expect(quranApiConfigured()).toBe(false);
  });
});

describe('which translation the captions carry', () => {
  it('is Saheeh International on the open API, which is what it has', () => {
    expect(defaultTranslationId()).toBe('20');
  });

  it('is The Clear Quran once the Foundation API is configured', () => {
    process.env.QURAN_FOUNDATION_CLIENT_ID = 'abc';
    process.env.QURAN_FOUNDATION_CLIENT_SECRET = 'shh';
    expect(defaultTranslationId()).toBe('131');
  });

  it('lets an explicit id win over both', () => {
    process.env.QURAN_TRANSLATION_ID = '85';
    expect(defaultTranslationId()).toBe('85');
    process.env.QURAN_FOUNDATION_CLIENT_ID = 'abc';
    process.env.QURAN_FOUNDATION_CLIENT_SECRET = 'shh';
    expect(defaultTranslationId()).toBe('85');
  });

  it('accepts the public copy of the same value', () => {
    process.env.NEXT_PUBLIC_QURAN_TRANSLATION_ID = '149';
    expect(defaultTranslationId()).toBe('149');
  });
});
