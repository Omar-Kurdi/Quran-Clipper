import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBooleanPreference, createNumberPreference } from './uiPreference';

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

describe('createNumberPreference', () => {
  const range = { min: 0, max: 1 };

  it('uses the fallback when nothing has been stored', () => {
    expect(createNumberPreference('qc-vol', 0.5, range).get()).toBe(0.5);
  });

  it('round-trips a value through storage', () => {
    const pref = createNumberPreference('qc-vol', 0.5, range);
    pref.set(0.2);
    expect(pref.get()).toBe(0.2);
    // A fresh store reads the same value back, which is what a reload does.
    expect(createNumberPreference('qc-vol', 0.5, range).get()).toBe(0.2);
  });

  it('clamps what it is given and what it reads back', () => {
    const pref = createNumberPreference('qc-vol', 0.5, range);
    pref.set(4);
    expect(pref.get()).toBe(1);
    pref.set(-1);
    expect(pref.get()).toBe(0);
  });

  it('falls back rather than trusting a stored value that is not a number', () => {
    // A hand-edited entry, or one written by a version with another range.
    localStorage.setItem('qc-vol', 'loud');
    expect(createNumberPreference('qc-vol', 0.5, range).get()).toBe(0.5);
  });

  it('tells its listeners when the value changes', () => {
    const pref = createNumberPreference('qc-vol', 0.5, range);
    let told = 0;
    pref.subscribe(() => { told += 1; });
    pref.set(0.3);
    expect(told).toBe(1);
  });

  it('renders the fallback on the server, where there is no storage', () => {
    const pref = createNumberPreference('qc-vol', 0.5, range);
    pref.set(0.9);
    expect(pref.getServerSnapshot()).toBe(0.5);
  });
});
