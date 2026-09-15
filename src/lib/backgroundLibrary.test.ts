import { describe, it, expect } from 'vitest';
import {
  storedBackgroundUrl, restoredBackgroundUrl, withStoredBackgrounds, withRestoredBackgrounds,
  type LibraryItem
} from './backgroundLibrary';

/** One upload and one pasted link, as a session would hold them. */
const session = (uploadUrl: string | null): LibraryItem[] => [
  { id: 'bg_a', kind: 'video', label: 'dunes.mp4', source: 'upload', url: uploadUrl },
  { id: 'bg_b', kind: 'image', label: 'sky', source: 'link', url: 'https://example.com/sky.jpg' }
];

const PEXELS = 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4';

describe('storedBackgroundUrl', () => {
  it('names an upload by its library id', () => {
    // The bug this exists for: a project row held `blob:...`, which is valid
    // only for the tab that minted it, so the background was gone on reopening.
    expect(storedBackgroundUrl('blob:http://localhost:3000/abc', session('blob:http://localhost:3000/abc')))
      .toBe('qcbg:bg_a');
  });

  it('leaves a link alone', () => {
    // A link is already durable; rewriting it would lose the only copy.
    expect(storedBackgroundUrl(PEXELS, session('blob:x'))).toBe(PEXELS);
    expect(storedBackgroundUrl('https://example.com/sky.jpg', session('blob:x')))
      .toBe('https://example.com/sky.jpg');
  });

  it('leaves a blob url the library does not own', () => {
    // A background taken from the uploaded recitation's own video is not a
    // library entry, and there is nothing to refer to it by.
    expect(storedBackgroundUrl('blob:http://localhost:3000/zzz', session('blob:http://localhost:3000/abc')))
      .toBe('blob:http://localhost:3000/zzz');
  });
});

describe('restoredBackgroundUrl', () => {
  it('gives back this session’s url for a stored upload', () => {
    expect(restoredBackgroundUrl('qcbg:bg_a', session('blob:http://localhost:3000/fresh')))
      .toBe('blob:http://localhost:3000/fresh');
  });

  it('keeps the reference when the file is gone', () => {
    // Not the default background: substituting one would look like a repair
    // while replacing a choice the user made, and the next save would keep it.
    expect(restoredBackgroundUrl('qcbg:bg_a', session(null))).toBe('qcbg:bg_a');
    expect(restoredBackgroundUrl('qcbg:bg_gone', session('blob:x'))).toBe('qcbg:bg_gone');
  });

  it('leaves anything that is not a reference', () => {
    expect(restoredBackgroundUrl(PEXELS, session('blob:x'))).toBe(PEXELS);
    expect(restoredBackgroundUrl('', session('blob:x'))).toBe('');
  });
});

/** A styling config mid-session: one upload, one link, in all three places. */
const live = {
  bgType: 'video',
  bgUrl: 'blob:http://localhost:3000/abc',
  bgUrls: ['blob:http://localhost:3000/abc', PEXELS],
  bgSegments: [
    { url: 'blob:http://localhost:3000/abc', start: 0, end: 9 },
    { url: PEXELS, start: 9, end: 20 }
  ],
  bgCycleSeconds: 5
};

/** What that config looks like in the row, with the upload named by id. */
const asSaved = () => withStoredBackgrounds(live, session('blob:http://localhost:3000/abc'));

describe('a config round trip', () => {
  it('rewrites all three places a background url is kept', () => {
    // `bgUrls` is empty in every project saved so far, which is exactly why it
    // is the one that would be forgotten.
    const stored = asSaved();
    expect(stored.bgUrl).toBe('qcbg:bg_a');
    expect(stored.bgUrls).toEqual(['qcbg:bg_a', PEXELS]);
    expect(stored.bgSegments.map(segment => segment.url)).toEqual(['qcbg:bg_a', PEXELS]);
  });

  it('comes back playable in a later session, under a new object url', () => {
    // The url differs between the two: every upload is minted afresh by
    // `hydrateLibrary`, which is the whole reason the id is what gets stored.
    const back = withRestoredBackgrounds(asSaved(), session('blob:http://localhost:3000/next'));
    expect(back.bgUrl).toBe('blob:http://localhost:3000/next');
    expect(back.bgUrls).toEqual(['blob:http://localhost:3000/next', PEXELS]);
    expect(back.bgSegments).toEqual([
      { url: 'blob:http://localhost:3000/next', start: 0, end: 9 },
      { url: PEXELS, start: 9, end: 20 }
    ]);
  });

  it('leaves everything that is not a background url', () => {
    const stored = asSaved();
    expect(stored.bgType).toBe('video');
    expect(stored.bgCycleSeconds).toBe(5);
  });
});

describe('saving a project that was loaded from a saved one', () => {
  it('finds the same id again from the url this session minted', () => {
    // Otherwise the second save writes back a dead url and the fix lasts
    // exactly one round trip.
    const later = session('blob:http://localhost:3000/next');
    const reSaved = withStoredBackgrounds(withRestoredBackgrounds(asSaved(), later), later);
    expect(reSaved).toEqual(asSaved());
  });
});

describe('a background whose file is gone', () => {
  it('keeps the segment rather than dropping it', () => {
    // Removing it would shift what every segment after it covers.
    const back = withRestoredBackgrounds(asSaved(), session(null));
    expect(back.bgSegments).toEqual([
      { url: 'qcbg:bg_a', start: 0, end: 9 },
      { url: PEXELS, start: 9, end: 20 }
    ]);
  });
});
