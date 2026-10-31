import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bookmarkOf, reciterGroups, toggled, toggledBookmark, usedLast } from './sourceShortcuts';
import { createListPreference } from './uiPreference';

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
});

const reciters = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('favourite and recent reciters', () => {
  it('star and unstar a reciter', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('keep the three used last, the latest first, with no repeats', () => {
    expect(usedLast(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b']);
    expect(usedLast(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('list favourites first, then recent ones that are not favourites, then everyone', () => {
    const groups = reciterGroups(reciters, ['c', 'gone'], ['c', 'b', 'gone']);
    expect(groups.favourites.map(r => r.id)).toEqual(['c']);
    expect(groups.recent.map(r => r.id)).toEqual(['b']);
    expect(groups.all.map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('bookmarked passages', () => {
  it('add a passage first and take it away again', () => {
    const one = { surah: 67, start: 1, end: 5 };
    const added = toggledBookmark([{ surah: 1, start: 1, end: 7 }], one);
    expect(added[0]).toEqual(one);
    expect(toggledBookmark(added, { ...one })).toEqual([{ surah: 1, start: 1, end: 7 }]);
  });

  it('only keep what is a passage', () => {
    expect(bookmarkOf({ surah: 2, start: 255, end: 257 })).toEqual({ surah: 2, start: 255, end: 257 });
    expect(bookmarkOf({ surah: 115, start: 1, end: 1 })).toBeNull();
    expect(bookmarkOf({ surah: 2, start: 5, end: 4 })).toBeNull();
    expect(bookmarkOf('2:255')).toBeNull();
  });
});

describe('a list kept per browser', () => {
  it('round-trips through storage, dropping what does not parse and what is past its length', () => {
    const list = createListPreference('qc-list', entry => (typeof entry === 'string' ? entry : null), 2);
    list.set(['a', 'b']);
    expect(createListPreference('qc-list', entry => (typeof entry === 'string' ? entry : null), 2).get()).toEqual(['a', 'b']);
    store['qc-list'] = JSON.stringify(['x', 3, 'y', 'z']);
    expect(createListPreference('qc-list', entry => (typeof entry === 'string' ? entry : null), 2).get()).toEqual(['x', 'y']);
  });

  it('is empty on the server, on broken storage, and the same value on repeated reads', () => {
    const list = createListPreference('qc-list', entry => (typeof entry === 'string' ? entry : null), 2);
    store['qc-list'] = '{not json';
    expect(list.get()).toEqual([]);
    expect(list.get()).toBe(list.get());
    list.set(['a']);
    expect(list.getServerSnapshot()).toEqual([]);
  });
});
