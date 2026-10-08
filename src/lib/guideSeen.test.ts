import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { guideSeen, rememberGuideSeen } from './guideSeen';

describe('guideSeen', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is offered once, then remembered', () => {
    expect(guideSeen('en')).toBe(false);
    expect(rememberGuideSeen('en')).toBe(true);
    expect(guideSeen('en')).toBe(true);
  });

  it('is offered again in a language it has not been seen in', () => {
    rememberGuideSeen('en');
    expect(guideSeen('ar')).toBe(false);
  });

  it('does not count the tour from before the redesign as having seen it', () => {
    store.set('quranclipper.tour.v1', '1');
    expect(guideSeen('en')).toBe(false);
  });

  it('counts as seen where storage cannot be read, and reports a refused write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(guideSeen('en')).toBe(true);
    expect(rememberGuideSeen('en')).toBe(false);
  });
});
