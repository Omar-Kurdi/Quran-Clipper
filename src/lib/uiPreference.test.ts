import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBooleanPreference } from './uiPreference';

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
});

describe('createBooleanPreference', () => {
  it('uses the fallback when nothing has been stored', () => {
    expect(createBooleanPreference('qc-x', true).get()).toBe(true);
    expect(createBooleanPreference('qc-y', false).get()).toBe(false);
  });

  it('round-trips a value through storage', () => {
    const pref = createBooleanPreference('qc-x', true);
    pref.set(false);
    expect(pref.get()).toBe(false);
    // A fresh reader sees it too -- this is what survives a reload.
    expect(createBooleanPreference('qc-x', true).get()).toBe(false);
  });

  it('always reports the fallback to the server', () => {
    // The server has no storage, so it must render the default and hydrate to
    // it; a client-only value here is a hydration mismatch.
    const pref = createBooleanPreference('qc-x', true);
    pref.set(false);
    expect(pref.getServerSnapshot()).toBe(true);
  });

  it('returns the same value on repeated reads, as the store contract needs', () => {
    // useSyncExternalStore compares snapshots by identity every render; a
    // snapshot that re-derives itself would loop.
    const pref = createBooleanPreference('qc-x', true);
    expect(pref.get()).toBe(pref.get());
  });

  it('tells subscribers when the value changes', () => {
    const pref = createBooleanPreference('qc-x', true);
    let calls = 0;
    pref.subscribe(() => { calls++; });
    pref.set(false);
    expect(calls).toBe(1);
  });

  it('keeps working when storage throws', () => {
    // Private mode and sandboxed frames both do this. A preference is not
    // worth failing a render over.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    const pref = createBooleanPreference('qc-x', true);
    expect(pref.get()).toBe(true);
    expect(() => pref.set(false)).not.toThrow();
    expect(pref.get()).toBe(false);
  });
});
