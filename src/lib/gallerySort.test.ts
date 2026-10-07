import { describe, it, expect } from 'vitest';
import { sortGallery } from './gallerySort';

const bg = (title: string, url: string | null, extra: Partial<{ missing: boolean; removable: boolean }> = {}) =>
  ({ title, url, missing: false, removable: false, ...extra });
const items = [
  bg('Moon', 'a.mp4'),
  bg('Clouds', 'b.mp4'),
  bg('Still', 'c.jpg', { removable: true }),
  bg('Gone', 'd.mp4', { missing: true, removable: true }),
  bg('Mine', 'e.mp4', { removable: true }),
];
const lengths = { 'a.mp4': 12, 'b.mp4': 40, 'e.mp4': 25, 'd.mp4': 90 };
const titles = (list: typeof items) => list.map(i => i.title);

describe('sortGallery', () => {
  it('lists the longest first, then what has no length, and a missing file last', () => {
    expect(titles(sortGallery(items, 'longest', lengths))).toEqual(['Clouds', 'Mine', 'Moon', 'Still', 'Gone']);
  });

  it('can list the shortest first instead', () => {
    expect(titles(sortGallery(items, 'shortest', lengths))).toEqual(['Moon', 'Mine', 'Clouds', 'Still', 'Gone']);
  });

  it('sorts by name, or puts the user\'s own first in the gallery\'s order', () => {
    expect(titles(sortGallery(items, 'name', lengths))).toEqual(['Clouds', 'Mine', 'Moon', 'Still', 'Gone']);
    expect(titles(sortGallery(items, 'yours', lengths))).toEqual(['Still', 'Mine', 'Moon', 'Clouds', 'Gone']);
  });

  it('keeps the gallery\'s order for clips not measured yet', () => {
    expect(titles(sortGallery(items, 'longest', {}))).toEqual(['Moon', 'Clouds', 'Still', 'Mine', 'Gone']);
  });
});
